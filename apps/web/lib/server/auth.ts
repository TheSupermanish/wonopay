import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { col, isDuplicateKey, newId, now, NO_ID, plain, transaction } from "./db.ts";
import { sha256 } from "./hash.ts";

export { sha256 };

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = "wono_session";
const SESSION_DAYS = 30;

export interface Merchant {
  id: string;
  userId: string;
  email: string;
  storeName: string;
  settlementAddress: string | null;
  allowedOrigins: string[];
  apiKeyHint: string | null;
  /** Store logo as a PNG/JPEG/WebP data URL, or null. */
  logo: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64"), 64, SCRYPT);
  const want = Buffer.from(expected, "base64");
  return want.length === key.length && timingSafeEqual(key, want);
}

export function validateEmail(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined;
}

export async function createUser(email: string, password: string, storeName: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  return transaction(async (session) => {
    const userId = newId("usr");
    const time = now();
    const users = await col("users");
    const merchants = await col("merchants");
    try {
      await users.insertOne({ id: userId, email, password_hash: passwordHash, created_at: time }, { session });
    } catch (error) {
      if (isDuplicateKey(error)) throw new Error("EMAIL_TAKEN");
      throw error;
    }
    await merchants.insertOne(
      {
        id: newId("mer"),
        user_id: userId,
        store_name: storeName,
        settlement_address: null,
        allowed_origins: "[]",
        api_key_hash: null,
        api_key_hint: null,
        logo: null,
        created_at: time,
        updated_at: time,
      },
      { session },
    );
    return userId;
  });
}

// A dummy hash so unknown emails cost the same as wrong passwords.
let dummyHash: Promise<string> | undefined;

export async function authenticate(email: string, password: string): Promise<string | undefined> {
  const users = await col("users");
  const user = await users.findOne<{ id: string; password_hash: string }>({ email }, NO_ID);
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    return undefined;
  }
  return (await verifyPassword(password, user.password_hash)) ? user.id : undefined;
}

export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const sessions = await col("sessions");
  await sessions.insertOne({ token_hash: sha256(token), user_id: userId, expires_at: expires.toISOString(), created_at: now() });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const sessions = await col("sessions");
    await sessions.deleteOne({ token_hash: sha256(token) });
  }
  store.delete(SESSION_COOKIE);
}

interface MerchantRow {
  id: string;
  user_id: string;
  email: string;
  store_name: string;
  settlement_address: string | null;
  allowed_origins: string;
  api_key_hint: string | null;
  logo: string | null;
}

interface MerchantDoc {
  id: string;
  user_id: string;
  store_name: string;
  settlement_address: string | null;
  allowed_origins: string;
  api_key_hash: string | null;
  api_key_hint: string | null;
  logo: string | null;
  created_at: string;
  updated_at: string;
}

export function toMerchant(row: MerchantRow): Merchant {
  let origins: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_origins);
    if (Array.isArray(parsed)) origins = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    origins = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    storeName: row.store_name,
    settlementAddress: row.settlement_address,
    allowedOrigins: origins,
    apiKeyHint: row.api_key_hint,
    logo: row.logo,
  };
}

async function merchantRow(doc: MerchantDoc): Promise<MerchantRow | undefined> {
  const users = await col("users");
  const user = await users.findOne<{ email: string }>({ id: doc.user_id }, NO_ID);
  if (!user) return undefined;
  return {
    id: doc.id,
    user_id: doc.user_id,
    email: user.email,
    store_name: doc.store_name,
    settlement_address: doc.settlement_address,
    allowed_origins: doc.allowed_origins,
    api_key_hint: doc.api_key_hint,
    logo: doc.logo,
  };
}

/** The signed-in merchant, or undefined. */
export async function currentMerchant(): Promise<Merchant | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const sessions = await col("sessions");
  const session = await sessions.findOne<{ user_id: string; expires_at: string }>(
    { token_hash: sha256(token), expires_at: { $gt: now() } },
    NO_ID,
  );
  if (!session) return undefined;
  const merchants = await col<MerchantDoc>("merchants");
  const merchant = plain(await merchants.findOne({ user_id: session.user_id }));
  if (!merchant) return undefined;
  const row = await merchantRow(merchant);
  return row ? toMerchant(row) : undefined;
}

export async function merchantById(id: string): Promise<Merchant | undefined> {
  const merchants = await col<MerchantDoc>("merchants");
  const merchant = plain(await merchants.findOne({ id }));
  if (!merchant) return undefined;
  const row = await merchantRow(merchant);
  return row ? toMerchant(row) : undefined;
}

/** Merchant for a server-to-server API key (`Authorization: Bearer wono_sk_…`). */
export async function merchantByApiKey(header: string | null): Promise<Merchant | undefined> {
  const match = header?.match(/^Bearer (wono_sk_[A-Za-z0-9_-]{20,})$/);
  if (!match?.[1]) return undefined;
  const merchants = await col<MerchantDoc>("merchants");
  const merchant = plain(await merchants.findOne({ api_key_hash: sha256(match[1]) }));
  if (!merchant) return undefined;
  const row = await merchantRow(merchant);
  return row ? toMerchant(row) : undefined;
}

/** Create or rotate the merchant's API key. The plaintext is returned once and never stored. */
export async function rotateApiKey(merchantId: string): Promise<string> {
  const key = `wono_sk_${randomBytes(24).toString("base64url")}`;
  const merchants = await col("merchants");
  await merchants.updateOne({ id: merchantId }, { $set: { api_key_hash: sha256(key), api_key_hint: key.slice(-4), updated_at: now() } });
  return key;
}

// Simple in-process throttle for sign-in. A multi-instance deployment needs a shared store.
const attempts = new Map<string, { count: number; reset: number }>();

export function throttle(key: string, limit = 8, windowMs = 15 * 60_000): boolean {
  const time = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < time) {
    attempts.set(key, { count: 1, reset: time + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}
