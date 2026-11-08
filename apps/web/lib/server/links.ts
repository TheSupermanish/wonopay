import "server-only";
import { isSolanaAddress } from "@wono/sdk";
import { merchantById, type Merchant } from "./auth.ts";
import { col, isDuplicateKey, newId, now } from "./db.ts";
import { createInvoice, type InvoiceRow, UserError } from "./invoices.ts";

/**
 * Keyless payment links: anyone can ask Wono to collect for any Solana wallet, with no account
 * and no API key. Each wallet gets one hidden merchant record (no login: its user row has an
 * unusable password) so invoices keep their normal shape and verification. Nothing here can
 * redirect funds: the recipient is the wallet in the request, and paid still means a verified,
 * finalized USDC credit to it.
 */
const KEYLESS_EMAIL = (address: string) => `wallet:${address}`;

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

async function findMerchantId(address: string): Promise<string | undefined> {
  const users = await col("users");
  const user = await users.findOne({ email: KEYLESS_EMAIL(address) }, { projection: { id: 1, _id: 0 } });
  if (!user) return undefined;
  const merchants = await col("merchants");
  const merchant = await merchants.findOne({ user_id: user.id as string }, { projection: { id: 1, _id: 0 } });
  return merchant?.id as string | undefined;
}

/** The hidden merchant that collects for this wallet, created on first use. */
export async function walletMerchant(address: string): Promise<Merchant> {
  if (!isSolanaAddress(address)) throw new UserError("`to` must be a Solana wallet address.");
  let id = await findMerchantId(address);
  if (!id) {
    const time = now();
    const users = await col("users");
    const merchants = await col("merchants");
    // "keyless" is not a valid hash, so this user can never sign in.
    let userId: string;
    try {
      userId = newId("usr");
      await users.insertOne({ id: userId, email: KEYLESS_EMAIL(address), password_hash: "keyless", created_at: time });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another request created the user concurrently; use it.
      const existing = await users.findOne({ email: KEYLESS_EMAIL(address) }, { projection: { id: 1, _id: 0 } });
      userId = existing!.id as string;
    }
    try {
      const merchantId = newId("mer");
      await merchants.insertOne({
        id: merchantId,
        user_id: userId,
        store_name: short(address),
        settlement_address: address,
        allowed_origins: '["*"]',
        api_key_hash: null,
        api_key_hint: null,
        logo: null,
        logo_updated_at: null,
        created_at: time,
        updated_at: time,
      });
      id = merchantId;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another request created the merchant for this user concurrently; re-read it.
      id = await findMerchantId(address);
    }
  }
  return (await merchantById(id!))!;
}

export async function createLink(input: Record<string, unknown>): Promise<{ invoice: InvoiceRow; merchant: Merchant }> {
  const merchant = await walletMerchant(String(input.to ?? ""));
  const invoice = await createInvoice(merchant, {
    amount: String(input.amount ?? ""),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.reference === "string" ? { reference: input.reference } : {}),
    ...(typeof input.name === "string" ? { payeeName: input.name } : {}),
    ...(typeof input.expiresInHours === "number" ? { expiresInHours: input.expiresInHours } : {}),
  });
  return { invoice, merchant };
}

// Per-IP budget for creating links. In memory: a restart resets it, which is fine for a cap on spam.
const WINDOW_MS = 10 * 60_000;
const LIMIT = 60;
const hits = new Map<string, number[]>();

export function allowLinkCreate(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const cutoff = Date.now() - WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((time) => time > cutoff);
  if (recent.length >= LIMIT) return false;
  recent.push(Date.now());
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}

/** Public read endpoints answer any origin: invoices are not secret, and links are made from browsers. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
  return response;
}
