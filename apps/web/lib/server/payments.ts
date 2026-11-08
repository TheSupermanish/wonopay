import "server-only";
import {
  applyObservation,
  baseUnits,
  encodeErc20Transfer,
  getSignatureState,
  isDepositQuote,
  normalizeAddress,
  summarizeInvoice,
  verifySolanaTokenCredit,
  WonoError,
  type BoundQuote,
  type ContributionState,
  type DepositQuote,
} from "@wono/sdk";
import { sha256 } from "./hash.ts";
import { aurora, rpc, sourceToken, type SourceToken } from "./chain.ts";
import { APPROVAL_MARGIN_MS, APPROVAL_WINDOW_MS, SLIPPAGE_BPS } from "./config.ts";
import { col, isDuplicateKey, logEvent, newId, NO_ID, now, plain, transaction } from "./db.ts";
import {
  contributionsFor,
  invoiceRow,
  isExpired,
  recomputeInvoice,
  UserError,
  type ContributionRow,
  type InvoiceRow,
} from "./invoices.ts";
import {
  availableSponsor,
  broadcastSolana,
  buildSolanaTransfer,
  checkSignedSolanaTransfer,
  currentBlockHeight,
  type SolanaTransferSpec,
} from "./solana-tx.ts";

const MAX_CONTRIBUTIONS = 4;
const PREPARING_LOCK_MS = 60_000;

/** The `attempts` collection; one document per client-generated attempt key. */
interface AttemptDoc {
  id: string;
  invoice_id: string;
  token_hash: string;
  status: AttemptResult["status"];
  error: string | null;
  approve_before: string;
  created_at: string;
  updated_at: string;
}

interface SettlementLinkDoc {
  settlement_id: string;
  contribution_id: string;
  created_at: string;
}

export interface PartInput {
  assetId: string;
  /** Destination USDC base units this source should deliver. */
  amountOut: string;
  /** Payer's address on the source chain; also the refund address. */
  sourceAddress: string;
}

interface CheckedPart extends PartInput {
  token: SourceToken;
}

function providerError(error: unknown): string {
  if (error instanceof WonoError) return error.providerMessage ? `Aurora: ${error.providerMessage}` : error.message;
  if (error instanceof UserError) return error.message;
  return "Route unavailable.";
}

function payable(invoice: InvoiceRow | undefined): InvoiceRow {
  if (!invoice) throw new UserError("Invoice not found.", 404);
  if (invoice.state === "paid") throw new UserError("This invoice is already paid.", 409);
  if (isExpired(invoice)) throw new UserError("This invoice has expired.", 410);
  return invoice;
}

async function remainingNow(invoiceId: string, amount: string, credited: string): Promise<string> {
  const parts = await contributionsFor(invoiceId);
  return summarizeInvoice(amount, parts.map((part) => ({ state: part.state, amountOut: part.amount_out })), credited).remaining;
}

/** `exact`: shares must cover the remaining amount exactly (reserving). Indicative quotes accept any total up to it. */
async function checkParts(parts: unknown, remaining: string, exact = true): Promise<CheckedPart[]> {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_CONTRIBUTIONS) {
    throw new UserError(`Choose between 1 and ${MAX_CONTRIBUTIONS} sources.`);
  }
  const checked: CheckedPart[] = [];
  const seen = new Set<string>();
  let total = 0n;
  for (const raw of parts as PartInput[]) {
    const token = await sourceToken(String(raw?.assetId ?? ""));
    if (!token) throw new UserError("One of the selected tokens is not payable through Wono.");
    if (seen.has(token.assetId)) throw new UserError("Each token can be used once per payment.");
    seen.add(token.assetId);
    let amountOut: string;
    let sourceAddress: string;
    try {
      amountOut = baseUnits(raw.amountOut, "amountOut");
      sourceAddress = normalizeAddress(token.chain.kind, String(raw.sourceAddress ?? ""));
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Invalid contribution.");
    }
    total += BigInt(amountOut);
    checked.push({ assetId: token.assetId, amountOut, sourceAddress, token });
  }
  if (exact ? total !== BigInt(remaining) : total > BigInt(remaining)) {
    throw new UserError(
      exact ? `Contributions must add up to exactly the remaining ${remaining} base units.` : `Contributions exceed the remaining ${remaining} base units.`,
      409,
    );
  }
  return checked;
}

/**
 * A share paid in the invoice asset itself (native USDC on Solana) needs no swap and no
 * bridge, so it skips Aurora: the customer's wallet transfers it straight to the merchant.
 * It is verified exactly like an Aurora delivery: a finalized credit of the invoice mint to
 * the invoice recipient, recorded once per signature.
 */
export interface DirectRoute {
  direct: true;
  recipient: string;
  mint: string;
  amountIn: string;
  amountOut: string;
}

type Route = DepositQuote | DirectRoute;

function isDirect(route: unknown): route is DirectRoute {
  return typeof route === "object" && route !== null && (route as DirectRoute).direct === true;
}

function isDirectPart(invoice: InvoiceRow, part: CheckedPart): boolean {
  return part.token.blockchain === "sol" && part.assetId === invoice.asset_id && part.token.contractAddress === invoice.mint;
}

function directRoute(invoice: InvoiceRow, part: CheckedPart): DirectRoute {
  return { direct: true, recipient: invoice.recipient, mint: invoice.mint, amountIn: part.amountOut, amountOut: part.amountOut };
}

function parseRoute(json: string | null): Route | undefined {
  if (!json) return undefined;
  const value = JSON.parse(json) as BoundQuote | DirectRoute;
  if (isDirect(value)) return value;
  return isDepositQuote(value) ? value : undefined;
}

function route(invoice: InvoiceRow, part: CheckedPart, deadline: string) {
  return {
    originAsset: part.assetId,
    destinationAsset: invoice.asset_id,
    amountOut: part.amountOut,
    recipient: invoice.recipient,
    refundTo: part.sourceAddress,
    deadline,
    slippageBps: SLIPPAGE_BPS,
  };
}

// ---------------------------------------------------------------------------
// Indicative quotes

/** What the checkout shows for one share before anything is reserved. */
export interface QuotePreview {
  amountIn: string;
  amountOut: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  timeEstimateSeconds?: number;
  /** Paid straight to the merchant: no Aurora route, no route fee. */
  direct?: boolean;
}

export type DryQuoteResult =
  | { assetId: string; ok: true; quote: QuotePreview }
  | { assetId: string; ok: false; error: string };

function usd(amount: string, decimals: number, price: number | undefined): string | undefined {
  if (!price) return undefined;
  const micros = (BigInt(amount) * BigInt(Math.round(price * 1e6))) / 10n ** BigInt(decimals);
  return (Number(micros) / 1e6).toFixed(6);
}

export async function dryQuotes(invoiceId: string, parts: unknown): Promise<DryQuoteResult[]> {
  const invoice = payable(await invoiceRow(invoiceId));
  const checked = await checkParts(parts, await remainingNow(invoice.id, invoice.amount, invoice.credited), false);
  const deadline = new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString();
  return Promise.all(
    checked.map(async (part): Promise<DryQuoteResult> => {
      try {
        if (isDirectPart(invoice, part)) {
          const value = usd(part.amountOut, part.token.decimals, part.token.price);
          return {
            assetId: part.assetId,
            ok: true,
            quote: { amountIn: part.amountOut, amountOut: part.amountOut, ...(value ? { amountInUsd: value, amountOutUsd: value } : {}), timeEstimateSeconds: 15, direct: true },
          };
        }
        const quote = await aurora().dryQuote(route(invoice, part, deadline));
        return {
          assetId: part.assetId,
          ok: true,
          quote: {
            amountIn: quote.amountIn,
            amountOut: quote.amountOut,
            ...(quote.amountInUsd ? { amountInUsd: quote.amountInUsd } : {}),
            ...(quote.amountOutUsd ? { amountOutUsd: quote.amountOutUsd } : {}),
            ...(quote.timeEstimateSeconds !== undefined ? { timeEstimateSeconds: quote.timeEstimateSeconds } : {}),
          },
        };
      } catch (error) {
        return { assetId: part.assetId, ok: false, error: providerError(error) };
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Attempts

export interface AttemptResult {
  attemptId: string;
  status: "ready" | "failed" | "preparing";
  error: string | null;
}

/**
 * Prepare a payment attempt: reserve one Aurora deposit route per source and persist
 * every route before any of them is shown. `key` is a client-generated secret; it
 * makes retries idempotent and authorizes later wallet actions on this attempt.
 */
export async function createAttempt(invoiceId: string, key: string, parts: unknown): Promise<AttemptResult> {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw new UserError("Missing attempt key.");
  const tokenHash = sha256(key);
  const existing = await (await col<AttemptDoc>("attempts")).findOne({ invoice_id: invoiceId, token_hash: tokenHash }, NO_ID);
  if (existing) return { attemptId: existing.id, status: existing.status, error: existing.error };

  const initial = payable(await invoiceRow(invoiceId));
  const checked = await checkParts(parts, await remainingNow(initial.id, initial.amount, initial.credited));
  const approveBefore = new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString();
  const attemptId = newId("att");

  await transaction(async (session) => {
    const invoice = payable(plain(await (await col<InvoiceRow>("invoices")).findOne({ id: invoiceId }, { ...NO_ID, session })));
    const busy = await (await col<AttemptDoc>("attempts")).findOne(
      { invoice_id: invoiceId, status: "preparing", updated_at: { $gt: new Date(Date.now() - PREPARING_LOCK_MS).toISOString() } },
      { ...NO_ID, session },
    );
    if (busy) throw new UserError("Another payment for this invoice is being prepared. Try again in a moment.", 409);
    const remaining = await remainingNow(invoice.id, invoice.amount, invoice.credited);
    const total = checked.reduce((sum, part) => sum + BigInt(part.amountOut), 0n);
    if (total !== BigInt(remaining)) throw new UserError("The amount due changed. Review the payment again.", 409);
    const time = now();
    // Routes that were never put in front of a wallet can be replaced safely.
    const replaced = await (await col<ContributionRow>("contributions")).updateMany(
      { invoice_id: invoiceId, state: "quoted" },
      { $set: { state: "cancelled", detail: "Replaced by a newer payment before approval.", updated_at: time } },
      { session },
    );
    await (await col<AttemptDoc>("attempts")).insertOne(
      { id: attemptId, invoice_id: invoiceId, token_hash: tokenHash, status: "preparing", error: null, approve_before: approveBefore, created_at: time, updated_at: time },
      { session },
    );
    await logEvent(invoiceId, "attempt.preparing", { attemptId, parts: checked.length, replaced: replaced.modifiedCount }, undefined, session);
  });

  const quotes = await Promise.allSettled(
    checked.map((part): Promise<Route> => (isDirectPart(initial, part) ? Promise.resolve(directRoute(initial, part)) : aurora().depositQuote(route(initial, part, approveBefore)))),
  );
  const failures = quotes.flatMap((result, index) => (result.status === "rejected" ? [`${checked[index]!.token.symbol}: ${providerError(result.reason)}`] : []));
  const status: AttemptResult["status"] = failures.length ? "failed" : "ready";
  const error = failures.length ? failures.join(" · ") : null;

  await transaction(async (session) => {
    const time = now();
    for (const [index, result] of quotes.entries()) {
      if (result.status !== "fulfilled") continue;
      const part = checked[index]!;
      const quote = result.value;
      await (await col<ContributionRow>("contributions")).insertOne(
        {
          id: newId("ctb"),
          attempt_id: attemptId,
          invoice_id: invoiceId,
          position: index,
          chain: part.token.blockchain,
          origin_asset: part.assetId,
          origin_symbol: part.token.symbol,
          origin_decimals: part.token.decimals,
          origin_contract: part.token.contractAddress ?? null,
          source_address: part.sourceAddress,
          amount_out: part.amountOut,
          // A partially prepared attempt is never offered: its routes are kept for audit only.
          state: status === "ready" ? "quoted" : "cancelled",
          quote_json: JSON.stringify(quote),
          deposit_address: isDirect(quote) ? null : quote.depositAddress,
          amount_in: quote.amountIn,
          provider_status: null,
          provider_json: null,
          tx_hash: null,
          signed_tx: null,
          last_valid_block_height: null,
          fee_payer: null,
          wallet_method: null,
          detail: null,
          approval_requested_at: null,
          submitted_at: null,
          created_at: time,
          updated_at: time,
        },
        { session },
      );
    }
    await (await col<AttemptDoc>("attempts")).updateOne({ id: attemptId }, { $set: { status, error, updated_at: time } }, { session });
    await logEvent(invoiceId, `attempt.${status}`, { attemptId, error }, undefined, session);
  });
  await recomputeInvoice(invoiceId);
  return { attemptId, status, error };
}

// ---------------------------------------------------------------------------
// Wallet hand-off

interface AuthorizedBatch {
  rows: ContributionRow[];
  quotes: Route[];
  approveBefore: string;
  invoice: InvoiceRow;
}

/**
 * Load contributions for one wallet action. All must belong to the same attempt (whose
 * key the caller holds), the same chain, and the same payer. EVM batches hold one row.
 */
async function authorize(contributionIds: unknown, key: string): Promise<AuthorizedBatch> {
  if (!Array.isArray(contributionIds) || contributionIds.length === 0 || contributionIds.length > MAX_CONTRIBUTIONS) {
    throw new UserError("Choose the contributions to approve.");
  }
  const ids = [...new Set(contributionIds.map(String))];
  const found = await (await col<ContributionRow>("contributions")).find({ id: { $in: ids } }, NO_ID).toArray();
  const byId = new Map(found.map((row) => [row.id, row]));
  const rows = ids.map((id) => byId.get(id));
  if (rows.some((row) => !row) || typeof key !== "string") throw new UserError("Contribution not found.", 404);
  const list = rows as ContributionRow[];
  const first = list[0]!;
  if (list.some((row) => row.attempt_id !== first.attempt_id || row.chain !== first.chain || row.source_address !== first.source_address)) {
    throw new UserError("Only transfers from the same wallet and chain can be approved together.");
  }
  if (first.chain !== "sol" && list.length !== 1) throw new UserError("EVM transfers are approved one at a time.");
  const attempt = await (await col<AttemptDoc>("attempts")).findOne({ id: first.attempt_id }, NO_ID);
  if (!attempt || attempt.token_hash !== sha256(key)) throw new UserError("This payment was started in another browser session.", 403);
  const quotes = list.map((row) => {
    const quote = parseRoute(row.quote_json);
    if (!quote) throw new UserError("Contribution has no route.", 409);
    return quote;
  });
  const invoice = await invoiceRow(first.invoice_id);
  if (!invoice) throw new UserError("Invoice not found.", 404);
  return { rows: list, quotes, approveBefore: attempt.approve_before, invoice };
}

function solanaSpecs(batch: Pick<AuthorizedBatch, "rows" | "quotes">): SolanaTransferSpec[] {
  return batch.rows.map((row, index) => {
    const quote = batch.quotes[index]!;
    return {
      from: row.source_address,
      // Direct shares pay the merchant's wallet; the rest pay their Aurora deposit address.
      to: isDirect(quote) ? quote.recipient : quote.depositAddress,
      amount: quote.amountIn,
      ...(row.origin_contract ? { mint: row.origin_contract } : {}),
      decimals: row.origin_decimals,
    };
  });
}

export type WalletRequest =
  | { kind: "evm"; chainId: number; transaction: { from: string; to: string; value: string; data?: string } }
  | { kind: "solana"; method: "signTransaction" | "signAndSendTransaction"; transaction: string; lastValidBlockHeight: number; sponsored: boolean };

/**
 * Build the exact transfer(s) for the payer's wallet and atomically mark every included
 * contribution `awaiting_approval`. Solana contributions from one wallet share a single
 * transaction: one approval, and they land together or not at all. A contribution can
 * be put in front of a wallet only once.
 */
export async function requestApproval(
  contributionIds: unknown,
  key: string,
  from: string,
  method: "signTransaction" | "signAndSendTransaction" | "eth_sendTransaction",
): Promise<WalletRequest> {
  const batch = await authorize(contributionIds, key);
  const { rows, quotes, approveBefore, invoice } = batch;
  payable(invoice);
  const blocked = rows.find((row) => row.state !== "quoted");
  if (blocked) throw new UserError(`A selected contribution is ${blocked.state.replace("_", " ")}; it will not be requested again.`, 409);
  const ids = rows.map((row) => row.id);
  if (Date.parse(approveBefore) - APPROVAL_MARGIN_MS <= Date.now()) {
    await (await col<ContributionRow>("contributions")).updateMany(
      { id: { $in: ids }, state: "quoted" },
      { $set: { state: "expired", detail: "Approval window closed before the wallet was asked.", updated_at: now() } },
    );
    await recomputeInvoice(invoice.id);
    throw new UserError("This quote expired before approval. Start the payment again for current prices.", 410);
  }
  const first = rows[0]!;
  const token = await sourceToken(first.origin_asset);
  if (!token) throw new UserError("This token is no longer payable through Wono.", 409);
  let sender: string;
  try {
    sender = normalizeAddress(token.chain.kind, from);
  } catch {
    throw new UserError("The connected wallet address is invalid.");
  }
  if (sender !== first.source_address) throw new UserError("Connect the wallet this payment was quoted for.", 409);

  let request: WalletRequest;
  let lastValid: number | null = null;
  let feePayer: string | null = null;
  if (token.chain.kind === "solana") {
    if (method !== "signTransaction" && method !== "signAndSendTransaction") throw new UserError("Unsupported Solana wallet method.");
    // Sponsorship needs Wono to add its signature before broadcast, so it applies only to
    // signTransaction (the wallet signs, Wono broadcasts).
    const sponsor = method === "signTransaction" ? await availableSponsor() : undefined;
    let built;
    try {
      built = await buildSolanaTransfer(solanaSpecs(batch), sponsor);
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Could not build the Solana transfer.", 422);
    }
    lastValid = built.lastValidBlockHeight;
    feePayer = built.feePayer;
    request = { kind: "solana", method, transaction: built.transaction, lastValidBlockHeight: built.lastValidBlockHeight, sponsored: built.feePayer !== sender };
  } else {
    if (method !== "eth_sendTransaction") throw new UserError("Unsupported EVM wallet method.");
    const quote = quotes[0]!;
    if (isDirect(quote)) throw new UserError("Direct transfers are Solana only.", 409);
    request = {
      kind: "evm",
      chainId: token.chain.chainId!,
      transaction: first.origin_contract
        ? { from: sender, to: first.origin_contract, value: "0x0", data: encodeErc20Transfer(quote.depositAddress, quote.amountIn) }
        : { from: sender, to: quote.depositAddress, value: `0x${BigInt(quote.amountIn).toString(16)}` },
    };
  }
  await transaction(async (session) => {
    const time = now();
    const result = await (await col<ContributionRow>("contributions")).updateMany(
      { id: { $in: ids }, state: "quoted" },
      { $set: { state: "awaiting_approval", approval_requested_at: time, wallet_method: method, last_valid_block_height: lastValid, fee_payer: feePayer, detail: null, updated_at: time } },
      { session },
    );
    // All or nothing: a partially claimed batch is rolled back and never shown to the wallet.
    if (result.matchedCount !== ids.length) throw new UserError("A selected contribution was already sent to a wallet.", 409);
  });
  await Promise.all(
    rows.map((row, index) => {
      const quote = quotes[index]!;
      return logEvent(invoice.id, "contribution.awaiting_approval", { method, from: sender, amountIn: quote.amountIn, to: isDirect(quote) ? quote.recipient : quote.depositAddress, direct: isDirect(quote), batch: ids.length }, row.id);
    }),
  );
  await recomputeInvoice(invoice.id);
  return request;
}

export type WalletOutcome =
  | { type: "declined"; reason?: string }
  | { type: "solana_signed"; signedTransaction: string }
  | { type: "sent"; txHash: string }
  | { type: "uncertain"; reason?: string };

/** Record what the wallet did for a batch. Unclear outcomes become `unknown`; nothing is re-requested. */
export async function reportOutcome(contributionIds: unknown, key: string, outcome: WalletOutcome): Promise<ContributionState> {
  const batch = await authorize(contributionIds, key);
  const { rows, quotes, invoice } = batch;
  const first = rows[0]!;
  const ids = rows.map((row) => row.id);
  const reason = (value?: string) => (typeof value === "string" ? value.slice(0, 200) : undefined);
  const transition = async (state: ContributionState, fields: Record<string, string | number | null>, from: ContributionState[]) => {
    await transaction(async (session) => {
      const result = await (await col<ContributionRow>("contributions")).updateMany(
        { id: { $in: ids }, state: { $in: from } },
        { $set: { ...fields, state, updated_at: now() } },
        { session },
      );
      if (result.matchedCount !== ids.length) throw new UserError(`Contribution is ${first.state}; outcome not applied.`, 409);
    });
    const { signed_tx: _omit, ...logged } = fields;
    await Promise.all(ids.map((id) => logEvent(invoice.id, `contribution.${state}`, { outcome: outcome.type, ...logged }, id)));
  };

  switch (outcome?.type) {
    case "declined": {
      // Safe only when nothing could have been broadcast: an explicit EIP-1193 4001 rejection,
      // or a Solana signTransaction call (the wallet signs; only Wono broadcasts).
      await transition("quoted", { detail: reason(outcome.reason) ?? "Declined in wallet.", approval_requested_at: null }, ["awaiting_approval"]);
      break;
    }
    case "solana_signed": {
      if (first.chain !== "sol" || rows.some((row) => row.wallet_method !== "signTransaction")) throw new UserError("Unexpected signed transaction.", 409);
      let checked;
      try {
        checked = await checkSignedSolanaTransfer(String(outcome.signedTransaction), solanaSpecs(batch), first.fee_payer ?? undefined);
      } catch (error) {
        // Not broadcast by Wono. Resolved to expired once its blockhash can no longer land.
        await transition("unknown", { detail: error instanceof Error ? error.message : "Signed transaction rejected." }, ["awaiting_approval"]);
        break;
      }
      // Persist the signature and bytes BEFORE broadcasting.
      await transition("submitted", { tx_hash: checked.signature, signed_tx: checked.raw, submitted_at: now(), detail: null }, ["awaiting_approval"]);
      try {
        await broadcastSolana(checked.raw);
      } catch {
        await (await col<ContributionRow>("contributions")).updateMany(
          { id: { $in: ids } },
          { $set: { detail: "Broadcast not confirmed; Wono will rebroadcast the same signed transaction until it lands or expires.", updated_at: now() } },
        );
      }
      for (const quote of quotes) if (!isDirect(quote)) aurora().submitDeposit({ txHash: checked.signature, depositAddress: quote.depositAddress }).catch(() => undefined);
      break;
    }
    case "sent": {
      const hash = String(outcome.txHash ?? "");
      const valid = first.chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash) : /^0x[0-9a-fA-F]{64}$/.test(hash);
      if (!valid) throw new UserError("Invalid transaction hash.");
      await transition("submitted", { tx_hash: first.chain === "sol" ? hash : hash.toLowerCase(), submitted_at: now(), detail: null }, ["awaiting_approval", "unknown"]);
      for (const quote of quotes) if (!isDirect(quote)) aurora().submitDeposit({ txHash: hash, depositAddress: quote.depositAddress }).catch(() => undefined);
      break;
    }
    case "uncertain": {
      await transition("unknown", { detail: reason(outcome.reason) ?? "The wallet did not confirm whether it sent the transfer." }, ["awaiting_approval"]);
      break;
    }
    default:
      throw new UserError("Unknown wallet outcome.");
  }
  await recomputeInvoice(invoice.id);
  const updated = await (await col<ContributionRow>("contributions")).findOne({ id: first.id }, NO_ID);
  return updated!.state;
}

// ---------------------------------------------------------------------------
// Reconciliation

const running = new Map<string, Promise<InvoiceRow>>();

/** Reconcile every contribution of an invoice. Concurrent calls share one run. */
export function reconcileInvoice(invoiceId: string): Promise<InvoiceRow> {
  const active = running.get(invoiceId);
  if (active) return active;
  const run = reconcile(invoiceId).finally(() => running.delete(invoiceId));
  running.set(invoiceId, run);
  return run;
}

const OBSERVED: ReadonlySet<ContributionState> = new Set(["awaiting_approval", "submitted", "processing", "settled", "unknown"]);

type Update = (state: ContributionState, fields?: Record<string, string | number | null>) => Promise<void>;

async function reconcile(invoiceId: string): Promise<InvoiceRow> {
  const invoice = await invoiceRow(invoiceId);
  if (!invoice) throw new UserError("Invoice not found.", 404);
  const attemptDocs = await (await col<AttemptDoc>("attempts")).find({ invoice_id: invoiceId }, NO_ID).toArray();
  const attempts = new Map(attemptDocs.map((row) => [row.id, row.approve_before]));
  let height: number | undefined;
  const blockHeight = async () => (height ??= await currentBlockHeight());

  for (const row of await contributionsFor(invoiceId)) {
    const update: Update = async (state, fields = {}) => {
      await (await col<ContributionRow>("contributions")).updateOne({ id: row.id, state: row.state }, { $set: { ...fields, state, updated_at: now() } });
      if (state !== row.state) await logEvent(invoiceId, `contribution.${state}`, { from: row.state, ...fields }, row.id);
      row.state = state;
    };

    if (row.state === "quoted") {
      const deadline = attempts.get(row.attempt_id);
      if (deadline && Date.parse(deadline) <= Date.now()) {
        await update("expired", { detail: row.detail ? `${row.detail.replace(/\.$/, "")}; approval window closed. Nothing was sent.` : "Approval window closed; the wallet was never asked." });
      }
      continue;
    }
    const parsed = parseRoute(row.quote_json);
    if (!parsed) continue;
    if (isDirect(parsed)) {
      if (!OBSERVED.has(row.state)) continue;
      try {
        await reconcileDirect(invoice, row, update, blockHeight);
      } catch {
        // RPC trouble leaves the state unchanged.
      }
      continue;
    }
    const quote = parsed;
    // Routes believed unsent stay watched for surprise deposits until the route goes inactive.
    const active = Date.parse(quote.timeWhenInactive ?? quote.deadline) > Date.now();
    const watchUnsent = (row.state === "cancelled" || row.state === "expired") && row.approval_requested_at !== null && active;
    if (!OBSERVED.has(row.state) && !watchUnsent) continue;

    // 1. Provider evidence, bound to the saved quote.
    let providerPending = false;
    try {
      const observation = await aurora().observe(quote);
      providerPending = observation.status === "PENDING_DEPOSIT";
      const next = applyObservation(row.state, observation);
      await (await col<ContributionRow>("contributions")).updateOne({ id: row.id }, { $set: { provider_status: observation.status, provider_json: JSON.stringify(observation), updated_at: now() } });
      if (next !== row.state) {
        const detail =
          observation.status === "INCOMPLETE_DEPOSIT" ? "Deposit below the quoted amount; Aurora reports it incomplete and may refund it."
          : observation.status === "REFUNDED" ? `Refunded to ${row.source_address}${observation.refundReason ? ` (${observation.refundReason})` : ""}.`
          : next === "unknown" ? `Provider reported ${observation.status} for a route Wono considered ${row.state}.`
          : null;
        await update(next, { detail });
      }
      if (row.state === "settled") {
        await verifySettlement(invoice, row, observation.destinationTxHashes, update);
      }
    } catch (error) {
      if (error instanceof WonoError && error.code === "QUOTE_MISMATCH") {
        await update("unknown", { detail: `Aurora status does not match the saved route: ${error.message}` });
      } else {
        // Mirrors SQL's COALESCE(detail, ?): only fill a detail that is currently empty.
        await (await col<ContributionRow>("contributions")).updateOne({ id: row.id, detail: null }, { $set: { detail: "Aurora status temporarily unavailable.", updated_at: now() } });
      }
      continue;
    }
    if (!providerPending) continue;

    // 2. Source-chain evidence while Aurora has not seen a deposit yet.
    try {
      if (row.chain === "sol") await reconcileSolanaSource(row, update, blockHeight);
      else await reconcileEvmSource(row, quote, update);
    } catch {
      // RPC trouble leaves the state unchanged.
    }
  }

  await (await col<InvoiceRow>("invoices")).updateOne({ id: invoiceId }, { $set: { checked_at: now() } });
  return recomputeInvoice(invoiceId);
}

async function reconcileSolanaSource(row: ContributionRow, update: Update, blockHeight: () => Promise<number>): Promise<void> {
  if (row.tx_hash) {
    const status = await getSignatureState(rpc("sol"), row.tx_hash);
    if (status.status === "failed") {
      await update("failed", { detail: "The Solana transaction failed on-chain. Only the network fee was spent." });
      return;
    }
    if (status.status !== "not_found") {
      if (row.state === "unknown") await update("submitted", { detail: null });
      return;
    }
    if (row.last_valid_block_height !== null && (await blockHeight()) > row.last_valid_block_height) {
      // Not found after its blockhash expired at finalized height: it can never land.
      if (row.state === "submitted" || row.state === "unknown") await update("expired", { detail: "The signed transaction expired without landing. Nothing was sent." });
      return;
    }
    if (row.signed_tx && row.state === "submitted") await broadcastSolana(row.signed_tx).catch(() => undefined);
    return;
  }
  // No signature. With signTransaction only Wono can broadcast, so once the prepared
  // blockhash expires the transfer provably never happened.
  if (
    row.wallet_method === "signTransaction" &&
    (row.state === "awaiting_approval" || row.state === "unknown") &&
    row.last_valid_block_height !== null &&
    (await blockHeight()) > row.last_valid_block_height
  ) {
    await update("expired", { detail: "The wallet never returned a signature and the transaction can no longer land. Nothing was sent." });
  }
}

/**
 * A direct share has no provider: the Solana signature is the whole story. Failed or expired
 * signatures resolve as on the Aurora path; a landed one is verified as a settlement.
 */
async function reconcileDirect(invoice: InvoiceRow, row: ContributionRow, update: Update, blockHeight: () => Promise<number>): Promise<void> {
  if (!row.tx_hash) {
    await reconcileSolanaSource(row, update, blockHeight);
    return;
  }
  const status = await getSignatureState(rpc("sol"), row.tx_hash);
  if (status.status === "not_found" || status.status === "failed") {
    await reconcileSolanaSource(row, update, blockHeight);
    return;
  }
  if (row.state === "submitted" || row.state === "processing" || row.state === "unknown") await update("settled", { detail: null });
  if (row.state === "settled") await verifySettlement(invoice, row, [row.tx_hash], update);
}

async function reconcileEvmSource(row: ContributionRow, quote: DepositQuote, update: Update): Promise<void> {
  if (row.tx_hash) {
    const receipt = await rpc(row.chain).call<{ status?: string } | null>("eth_getTransactionReceipt", [row.tx_hash]);
    if (receipt?.status === "0x0") await update("failed", { detail: "The transaction reverted on-chain. Tokens did not move; only gas was spent." });
    else if (receipt?.status === "0x1" && row.state === "unknown") await update("submitted", { detail: null });
    return;
  }
  // Without a hash, only the route going inactive (days later) with no deposit settles it.
  const inactive = quote.timeWhenInactive ?? quote.deadline;
  if ((row.state === "awaiting_approval" || row.state === "unknown") && Date.parse(inactive) <= Date.now()) {
    await update("expired", { detail: "No deposit reached the route before it became inactive." });
  }
}

async function verifySettlement(invoice: InvoiceRow, row: ContributionRow, hashes: string[], update: Update): Promise<void> {
  if (hashes.length === 0) {
    if (row.state === "settled") {
      await (await col<ContributionRow>("contributions")).updateOne({ id: row.id }, { $set: { detail: "Aurora reports success; destination transaction not reported yet.", updated_at: now() } });
    }
    return;
  }
  let allVerified = true;
  for (const signature of hashes) {
    const linked = await (await col<{ id: string; invoice_id: string }>("settlements")).findOne({ chain: "sol", signature }, NO_ID);
    if (linked) {
      if (linked.invoice_id !== invoice.id) {
        await update("unknown", { detail: "This settlement transaction is already credited to another invoice. Manual review required." });
        return;
      }
      try {
        // UNIQUE(settlement_id, contribution_id) makes this an upsert, mirroring INSERT OR IGNORE.
        await (await col<SettlementLinkDoc>("settlement_links")).updateOne(
          { settlement_id: linked.id, contribution_id: row.id },
          { $setOnInsert: { settlement_id: linked.id, contribution_id: row.id, created_at: now() } },
          { upsert: true },
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
      continue;
    }
    const check = await verifySolanaTokenCredit(rpc("sol"), { signature, mint: invoice.mint, owner: invoice.recipient });
    if (check.status === "pending") {
      allVerified = false;
      continue;
    }
    if (check.status === "rejected") {
      await update("unknown", { detail: `Aurora reported success, but on-chain verification failed: ${check.reason}` });
      return;
    }
    await transaction(async (session) => {
      const id = newId("stl");
      // UNIQUE(chain, signature) guarantees one credit per settlement transaction.
      let inserted = true;
      try {
        await (await col("settlements")).insertOne(
          { id, invoice_id: invoice.id, chain: "sol", signature, mint: invoice.mint, owner: invoice.recipient, amount: check.amount, slot: check.slot, block_time: check.blockTime ?? null, verified_at: now() },
          { session },
        );
      } catch (error) {
        if (isDuplicateKey(error)) inserted = false;
        else throw error;
      }
      if (inserted) {
        await (await col<SettlementLinkDoc>("settlement_links")).insertOne({ settlement_id: id, contribution_id: row.id, created_at: now() }, { session });
        await logEvent(invoice.id, "settlement.verified", { signature, amount: check.amount, slot: check.slot }, row.id, session);
      }
    });
  }
  if (allVerified && row.state === "settled") await update("verified", { detail: null });
  else if (!allVerified && row.state === "settled") {
    await (await col<ContributionRow>("contributions")).updateOne({ id: row.id }, { $set: { detail: "Waiting for Solana finality before crediting.", updated_at: now() } });
  }
}
