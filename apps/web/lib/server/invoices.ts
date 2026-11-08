import "server-only";
import { sponsorFundedHint } from "./solana-tx.ts";
import { PublicKey } from "@solana/web3.js";
import {
  formatUnits,
  isSolanaAddress,
  SOLANA_USDC,
  sourceChain,
  summarizeInvoice,
  toBaseUnits,
  type BoundQuote,
  type ContributionState,
  type InvoiceState,
  type ProviderObservation,
} from "@wono/sdk";
import type { Merchant } from "./auth.ts";
import { catalog, rpc } from "./chain.ts";
import { col, isDuplicateKey, logEvent, newId, NO_ID, now, transaction, type Session } from "./db.ts";

export interface InvoiceRow {
  id: string;
  merchant_id: string;
  reference: string | null;
  description: string | null;
  amount: string;
  asset_id: string;
  mint: string;
  decimals: number;
  recipient: string;
  state: InvoiceState;
  credited: string;
  expires_at: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
  /** Display name for keyless links; account invoices use the store name. */
  payee_name: string | null;
}

export interface ContributionRow {
  id: string;
  attempt_id: string;
  invoice_id: string;
  position: number;
  chain: string;
  origin_asset: string;
  origin_symbol: string;
  origin_decimals: number;
  origin_contract: string | null;
  source_address: string;
  amount_out: string;
  state: ContributionState;
  quote_json: string | null;
  deposit_address: string | null;
  amount_in: string | null;
  provider_status: string | null;
  provider_json: string | null;
  tx_hash: string | null;
  signed_tx: string | null;
  /** Exact unsigned transaction shown to the wallet; absent on legacy contributions. */
  prepared_tx?: string | null;
  last_valid_block_height: number | null;
  fee_payer: string | null;
  wallet_method: string | null;
  detail: string | null;
  approval_requested_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementRow {
  id: string;
  invoice_id: string;
  chain: string;
  signature: string;
  mint: string;
  owner: string;
  amount: string;
  slot: number;
  block_time: number | null;
  verified_at: string;
}

export class UserError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Merchant settings

export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UserError(`"${value.trim()}" is not a URL. Use a full origin like https://shop.example.com.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new UserError(`${url.origin} must use https (http is allowed for localhost only).`);
  }
  return url.origin;
}

/**
 * A settlement wallet must be a Solana wallet (on-curve key owned by the System
 * Program or unused), not a token account or program address.
 */
export async function checkSettlementAddress(address: string): Promise<{ usdcAccountExists: boolean | null }> {
  if (!isSolanaAddress(address)) throw new UserError("Enter a Solana wallet address (base58, 32 bytes).");
  if (!PublicKey.isOnCurve(new PublicKey(address).toBytes())) {
    throw new UserError("That address is a program-derived address, not a wallet. Enter the wallet that should receive USDC.");
  }
  const info = await rpc("sol")
    .call<{ value: { owner?: string } | null }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }])
    .catch(() => undefined);
  if (info?.value?.owner && info.value.owner !== "11111111111111111111111111111111") {
    throw new UserError("That address is a token or program account. Enter the wallet (owner) address instead.");
  }
  const { associatedTokenAddress } = await import("./solana-tx.ts");
  const ata = associatedTokenAddress(address, SOLANA_USDC.mint, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ataInfo = await rpc("sol")
    .call<{ value: unknown }>("getAccountInfo", [ata, { encoding: "base64", commitment: "confirmed" }])
    .catch(() => undefined);
  return { usdcAccountExists: ataInfo === undefined ? null : ataInfo.value !== null };
}

export async function updateSettings(merchant: Merchant, input: { storeName: string; settlementAddress: string; origins: string }): Promise<void> {
  const storeName = input.storeName.trim();
  if (!storeName || storeName.length > 80) throw new UserError("Store name must be 1–80 characters.");
  const address = input.settlementAddress.trim();
  if (address) await checkSettlementAddress(address);
  const origins = [...new Set(input.origins.split(/[\s,]+/).filter(Boolean).map(normalizeOrigin))];
  if (origins.length > 20) throw new UserError("Up to 20 embed origins.");
  const merchants = await col("merchants");
  await merchants.updateOne(
    { id: merchant.id },
    { $set: { store_name: storeName, settlement_address: address || null, allowed_origins: JSON.stringify(origins), updated_at: now() } },
  );
}

const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const LOGO_MAX_CHARS = 200_000;

/** Sets or clears the store logo. Only raster images: SVG could carry script. */
export async function updateLogo(merchantId: string, dataUrl: string | null): Promise<void> {
  if (dataUrl !== null) {
    if (dataUrl.length > LOGO_MAX_CHARS) throw new UserError("Logo is too large. Use an image under 150 KB.");
    if (!LOGO_PATTERN.test(dataUrl)) throw new UserError("Logo must be a PNG, JPEG or WebP image.");
  }
  const merchants = await col("merchants");
  await merchants.updateOne({ id: merchantId }, { $set: { logo: dataUrl, logo_updated_at: dataUrl ? now() : null, updated_at: now() } });
}

/** The stored logo as bytes, for the public logo route. */
export async function merchantLogo(merchantId: string): Promise<{ type: string; bytes: Buffer } | null> {
  const merchants = await col("merchants");
  const row = await merchants.findOne({ id: merchantId }, { projection: { logo: 1, _id: 0 } });
  const match = (row?.logo as string | null | undefined)?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  return match ? { type: match[1]!, bytes: Buffer.from(match[2]!, "base64") } : null;
}

/** Path of the merchant's logo on this host (cache-busted by its last change), or null. */
async function merchantLogoPath(merchantId: string, session?: Session): Promise<string | null> {
  const merchants = await col("merchants");
  const row = await merchants.findOne(
    { id: merchantId, logo: { $ne: null } },
    { session, projection: { logo_updated_at: 1, _id: 0 } },
  );
  return row ? `/api/logos/${merchantId}?v=${encodeURIComponent((row.logo_updated_at as string | null) ?? "")}` : null;
}

// ---------------------------------------------------------------------------
// Invoices

export async function createInvoice(
  merchant: Merchant,
  input: { amount: string; description?: string; reference?: string; expiresInHours?: number; payeeName?: string },
): Promise<InvoiceRow> {
  if (!merchant.settlementAddress) throw new UserError("Add a Solana settlement wallet in Settings before creating invoices.", 409);
  // Re-check the live catalog: the asset id must still mean native Solana USDC.
  await catalog();
  let amount: string;
  try {
    amount = toBaseUnits(input.amount, SOLANA_USDC.decimals);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : "Invalid amount.");
  }
  if (BigInt(amount) < 1_000_000n) throw new UserError("Minimum invoice is 1 USDC.");
  if (BigInt(amount) > 1_000_000_000_000n) throw new UserError("Maximum invoice is 1,000,000 USDC.");
  const description = input.description?.trim().slice(0, 200) || null;
  const reference = input.reference?.trim().slice(0, 100) || null;
  const hours = input.expiresInHours;
  if (hours !== undefined && (!Number.isInteger(hours) || hours < 1 || hours > 24 * 90)) {
    throw new UserError("Expiry must be between 1 hour and 90 days.");
  }
  const time = now();
  const id = newId("inv");
  const invoices = await col<InvoiceRow>("invoices");
  try {
    await invoices.insertOne({
      id,
      merchant_id: merchant.id,
      reference,
      description,
      amount,
      asset_id: SOLANA_USDC.assetId,
      mint: SOLANA_USDC.mint,
      decimals: SOLANA_USDC.decimals,
      recipient: merchant.settlementAddress,
      state: "open" as InvoiceState,
      credited: "0",
      expires_at: hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
      checked_at: null,
      created_at: time,
      updated_at: time,
      payee_name: input.payeeName?.trim().slice(0, 60) || null,
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new UserError("An invoice with this reference already exists.", 409);
    throw error;
  }
  await logEvent(id, "invoice.created", { amount, recipient: merchant.settlementAddress });
  return (await invoiceRow(id))!;
}

export async function invoiceRow(id: string): Promise<InvoiceRow | undefined> {
  const invoices = await col<InvoiceRow>("invoices");
  return (await invoices.findOne({ id }, NO_ID)) ?? undefined;
}

export async function invoiceForMerchant(merchantId: string, id: string): Promise<InvoiceRow | undefined> {
  const invoices = await col<InvoiceRow>("invoices");
  return (await invoices.findOne({ id, merchant_id: merchantId }, NO_ID)) ?? undefined;
}

export async function listInvoices(merchantId: string, limit = 200): Promise<InvoiceRow[]> {
  const invoices = await col<InvoiceRow>("invoices");
  return invoices.find({ merchant_id: merchantId }, NO_ID).sort({ created_at: -1 }).limit(limit).toArray();
}

export async function contributionsFor(invoiceId: string, session?: Session): Promise<ContributionRow[]> {
  const contributions = await col<ContributionRow>("contributions");
  return contributions
    .find({ invoice_id: invoiceId }, { session, projection: { _id: 0 } })
    .sort({ created_at: 1, position: 1 })
    .toArray();
}

export async function settlementsFor(invoiceId: string, session?: Session): Promise<SettlementRow[]> {
  const settlements = await col<SettlementRow>("settlements");
  return settlements
    .find({ invoice_id: invoiceId }, { session, projection: { _id: 0 } })
    .sort({ slot: 1 })
    .toArray();
}

export async function eventsFor(invoiceId: string, limit = 100): Promise<{ type: string; data: unknown; created_at: string; contribution_id: string | null }[]> {
  const events = await col("events");
  const rows = (await events
    .find({ invoice_id: invoiceId }, { projection: { type: 1, data: 1, created_at: 1, contribution_id: 1, _id: 0 } })
    .sort({ seq: -1 })
    .limit(limit)
    .toArray()) as unknown as { type: string; data: string | null; created_at: string; contribution_id: string | null }[];
  return rows.map((row) => ({ ...row, data: row.data ? JSON.parse(row.data) : null }));
}

export function isExpired(invoice: InvoiceRow): boolean {
  return invoice.expires_at !== null && Date.parse(invoice.expires_at) <= Date.now();
}

/** Recompute and persist the invoice state from its contributions and distinct verified settlements. */
export async function recomputeInvoice(invoiceId: string): Promise<InvoiceRow> {
  return transaction(async (session) => {
    const invoices = await col<InvoiceRow>("invoices");
    const invoice = await invoices.findOne({ id: invoiceId }, { session, projection: { _id: 0 } });
    if (!invoice) throw new UserError("Invoice not found.", 404);
    const contributions = await col<ContributionRow>("contributions");
    const parts = (await contributions
      .find({ invoice_id: invoiceId }, { session, projection: { state: 1, amount_out: 1, _id: 0 } })
      .toArray()) as { state: ContributionState; amount_out: string }[];
    const settlements = await col<SettlementRow>("settlements");
    const amounts = (await settlements
      .find({ invoice_id: invoiceId }, { session, projection: { amount: 1, _id: 0 } })
      .toArray()) as { amount: string }[];
    const credited = amounts.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString();
    const summary = summarizeInvoice(invoice.amount, parts.map((part) => ({ state: part.state, amountOut: part.amount_out })), credited);
    if (summary.state !== invoice.state || summary.credited !== invoice.credited) {
      await invoices.updateOne({ id: invoiceId }, { $set: { state: summary.state, credited: summary.credited, updated_at: now() } }, { session });
      await logEvent(invoiceId, "invoice.state", { from: invoice.state, to: summary.state, credited: summary.credited }, undefined, session);
    }
    return { ...invoice, state: summary.state, credited: summary.credited };
  });
}

// ---------------------------------------------------------------------------
// Views (JSON-safe; amounts stay base-unit strings)

export interface ContributionView {
  id: string;
  attemptId: string;
  assetId: string;
  chain: string;
  chainName: string;
  symbol: string;
  decimals: number;
  sourceAddress: string;
  amountOut: string;
  amountIn: string | null;
  state: ContributionState;
  providerStatus: string | null;
  txHash: string | null;
  txUrl: string | null;
  depositAddress: string | null;
  walletMethod: string | null;
  approveBefore: string | null;
  quote: {
    amountInUsd?: string;
    amountOutUsd?: string;
    withdrawFee?: string;
    refundFee?: string;
    timeEstimateSeconds?: number;
    refundDeadline?: string;
  } | null;
  provider: Pick<ProviderObservation, "refundedAmount" | "refundReason" | "destinationTxHashes"> | null;
  detail: string | null;
  updatedAt: string;
}

export interface InvoiceView {
  id: string;
  merchantName: string;
  /** Store logo path on the Wono host, or null. */
  merchantLogo: string | null;
  description: string | null;
  reference: string | null;
  amount: string;
  decimals: number;
  symbol: string;
  destinationChain: string;
  recipient: string;
  state: InvoiceState;
  credited: string;
  reserved: string;
  remaining: string;
  excess: string;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  checkedAt: string | null;
  /** Wono pays Solana network fees and account rent (when its fee wallet is funded). */
  solanaGasSponsored: boolean;
  contributions: ContributionView[];
  settlements: { signature: string; amount: string; url: string; slot: number; verifiedAt: string }[];
}

export function contributionView(row: ContributionRow, approveBefore: string | null): ContributionView {
  const chain = sourceChain(row.chain);
  const quote = row.quote_json ? (JSON.parse(row.quote_json) as BoundQuote) : null;
  const provider = row.provider_json ? (JSON.parse(row.provider_json) as ProviderObservation) : null;
  return {
    id: row.id,
    attemptId: row.attempt_id,
    assetId: row.origin_asset,
    chain: row.chain,
    chainName: chain?.name ?? row.chain,
    symbol: row.origin_symbol,
    decimals: row.origin_decimals,
    sourceAddress: row.source_address,
    amountOut: row.amount_out,
    amountIn: row.amount_in,
    state: row.state,
    providerStatus: row.provider_status,
    txHash: row.tx_hash,
    txUrl: row.tx_hash && chain ? `${chain.explorerTx}${row.tx_hash}` : null,
    depositAddress: row.deposit_address,
    walletMethod: row.wallet_method,
    approveBefore,
    quote: quote
      ? {
          ...(quote.amountInUsd ? { amountInUsd: quote.amountInUsd } : {}),
          ...(quote.amountOutUsd ? { amountOutUsd: quote.amountOutUsd } : {}),
          ...(quote.withdrawFee ? { withdrawFee: quote.withdrawFee } : {}),
          ...(quote.refundFee ? { refundFee: quote.refundFee } : {}),
          ...(quote.timeEstimateSeconds !== undefined ? { timeEstimateSeconds: quote.timeEstimateSeconds } : {}),
          ...(quote.deadline ? { refundDeadline: quote.deadline } : {}),
        }
      : null,
    provider: provider
      ? { refundedAmount: provider.refundedAmount, refundReason: provider.refundReason, destinationTxHashes: provider.destinationTxHashes }
      : null,
    detail: row.detail,
    updatedAt: row.updated_at,
  };
}

export async function invoiceView(invoice: InvoiceRow, merchantName: string, options: { includeUnsent?: boolean } = {}): Promise<InvoiceView> {
  const rows = await contributionsFor(invoice.id);
  const attempts = await col("attempts");
  const attemptRows = (await attempts
    .find({ invoice_id: invoice.id }, { projection: { id: 1, approve_before: 1, _id: 0 } })
    .toArray()) as unknown as { id: string; approve_before: string }[];
  const attemptMap = new Map(attemptRows.map((row) => [row.id, row.approve_before]));
  const summary = summarizeInvoice(invoice.amount, rows.map((row) => ({ state: row.state, amountOut: row.amount_out })), invoice.credited);
  const visible = options.includeUnsent ? rows : rows.filter((row) => !(row.state === "cancelled" && !row.approval_requested_at));
  const settlements = await settlementsFor(invoice.id);
  return {
    id: invoice.id,
    merchantName: invoice.payee_name ?? merchantName,
    merchantLogo: await merchantLogoPath(invoice.merchant_id),
    description: invoice.description,
    reference: invoice.reference,
    amount: invoice.amount,
    decimals: invoice.decimals,
    symbol: "USDC",
    destinationChain: "Solana",
    recipient: invoice.recipient,
    state: invoice.state,
    credited: summary.credited,
    reserved: summary.reserved,
    remaining: summary.remaining,
    excess: summary.excess,
    expiresAt: invoice.expires_at,
    expired: isExpired(invoice),
    createdAt: invoice.created_at,
    checkedAt: invoice.checked_at,
    solanaGasSponsored: sponsorFundedHint(),
    contributions: visible.map((row) => contributionView(row, attemptMap.get(row.attempt_id) ?? null)),
    settlements: settlements.map((row) => ({
      signature: row.signature,
      amount: row.amount,
      url: `https://solscan.io/tx/${row.signature}`,
      slot: row.slot,
      verifiedAt: row.verified_at,
    })),
  };
}

export function formatUsdc(units: string): string {
  return formatUnits(units, SOLANA_USDC.decimals, 6);
}
