import { isBaseUnits } from "./amounts.ts";
import { invalidResponse, isRecord, quoteMismatch, record, text } from "./errors.ts";
import { assertEcho, type DepositQuote } from "./quotes.ts";

export const PROVIDER_STATUSES = [
  "KNOWN_DEPOSIT_TX",
  "PENDING_DEPOSIT",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** Aurora's account of one deposit route, already bound to the saved quote. Provider evidence only. */
export interface ProviderObservation {
  status: ProviderStatus;
  updatedAt?: string;
  originTxHashes: string[];
  destinationTxHashes: string[];
  intentHashes: string[];
  depositedAmount?: string;
  amountIn?: string;
  amountOut?: string;
  refundedAmount?: string;
  refundReason?: string;
}

function hashes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const hash = isRecord(entry) ? entry.hash : entry;
    return typeof hash === "string" && hash.length > 0 ? [hash] : [];
  });
}

function units(value: unknown): string | undefined {
  return isBaseUnits(value) ? value : undefined;
}

/**
 * Interpret a status response for a saved deposit route. The embedded quote must carry
 * the same signature, deposit address, memo, and request as the quote Wono stored;
 * otherwise this throws QUOTE_MISMATCH and the caller must treat the route as unknown.
 */
export function readStatus(response: unknown, saved: DepositQuote): ProviderObservation {
  const data = record(response, "status response");
  const status = data.status;
  if (typeof status !== "string" || !(PROVIDER_STATUSES as readonly string[]).includes(status)) {
    invalidResponse("Unknown provider status.");
  }
  const quoteResponse = record(data.quoteResponse, "status quote");
  if (text(quoteResponse.signature, "status quote signature") !== saved.signature) {
    quoteMismatch("Status refers to a different quote.");
  }
  const quote = record(quoteResponse.quote, "status quote body");
  if (quote.depositAddress !== saved.depositAddress || (quote.depositMemo ?? undefined) !== saved.depositMemo) {
    quoteMismatch("Status refers to a different deposit route.");
  }
  assertEcho(quoteResponse.quoteRequest, saved.request);

  const details = isRecord(data.swapDetails) ? data.swapDetails : {};
  const observation: ProviderObservation = {
    status: status as ProviderStatus,
    originTxHashes: hashes(details.originChainTxHashes),
    destinationTxHashes: hashes(details.destinationChainTxHashes),
    intentHashes: hashes(details.intentHashes),
  };
  if (typeof data.updatedAt === "string") observation.updatedAt = data.updatedAt;
  const depositedAmount = units(details.depositedAmount);
  const amountIn = units(details.amountIn);
  const amountOut = units(details.amountOut);
  const refundedAmount = units(details.refundedAmount);
  if (depositedAmount) observation.depositedAmount = depositedAmount;
  if (amountIn) observation.amountIn = amountIn;
  if (amountOut) observation.amountOut = amountOut;
  if (refundedAmount) observation.refundedAmount = refundedAmount;
  if (typeof details.refundReason === "string" && details.refundReason) observation.refundReason = details.refundReason;
  return observation;
}
