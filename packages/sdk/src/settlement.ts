import { subtractUnits } from "./amounts.ts";
import type { ProviderObservation } from "./status.ts";

/**
 * Lifecycle of one contribution (one source transfer to one deposit route).
 *
 * quoted             deposit route saved; wallet never asked
 * awaiting_approval  wallet prompt requested; outcome not yet reported
 * submitted          transfer identifier known (signed or broadcast)
 * processing         provider saw the deposit and is routing it
 * settled            provider reports success; not yet independently verified
 * verified           destination credit verified on-chain with finality
 * refunded           provider reports a refund to the payer's refund address
 * failed             provider or source chain reports failure
 * unknown            outcome cannot be established; never resend automatically
 * cancelled          never sent: payer declined, or the route was replaced before any prompt
 * expired            never sent: approval window passed (or signed tx provably expired)
 */
export const CONTRIBUTION_STATES = [
  "quoted",
  "awaiting_approval",
  "submitted",
  "processing",
  "settled",
  "verified",
  "refunded",
  "failed",
  "unknown",
  "cancelled",
  "expired",
] as const;
export type ContributionState = (typeof CONTRIBUTION_STATES)[number];

export const INVOICE_STATES = [
  "open",
  "quoted",
  "awaiting_approval",
  "submitted",
  "processing",
  "partial",
  "paid",
  "refunded",
  "failed",
  "unknown",
] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

/** States whose output may still reach (or already reached) the merchant: they reserve invoice capacity. */
const RESERVING: ReadonlySet<ContributionState> = new Set(["awaiting_approval", "submitted", "processing", "settled", "unknown"]);
/** States in which no transfer left the payer's wallet, or it came back. */
const RELEASED: ReadonlySet<ContributionState> = new Set(["quoted", "cancelled", "expired", "refunded", "failed"]);

export function reservesCapacity(state: ContributionState): boolean {
  return RESERVING.has(state);
}

export function isReleased(state: ContributionState): boolean {
  return RELEASED.has(state);
}

/** Map a bound provider observation onto a contribution. Pure; verification happens elsewhere. */
export function applyObservation(current: ContributionState, observation: ProviderObservation): ContributionState {
  if (current === "cancelled" || current === "expired") {
    // A route we believed unsent now shows activity. Surface it; never hide money movement.
    return observation.status === "PENDING_DEPOSIT" ? current : "unknown";
  }
  switch (observation.status) {
    case "PENDING_DEPOSIT":
      return current;
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
    case "INCOMPLETE_DEPOSIT":
      return current === "verified" ? "unknown" : "processing";
    case "SUCCESS":
      return current === "verified" ? "verified" : "settled";
    case "REFUNDED":
      return current === "verified" ? "unknown" : "refunded";
    case "FAILED":
      return current === "verified" ? "unknown" : "failed";
  }
}

export interface ContributionLike {
  state: ContributionState;
  /** Quoted exact output for this route, destination base units. */
  amountOut: string;
}

export interface InvoiceSummary {
  state: InvoiceState;
  /** Verified on-chain credit to the merchant, destination base units. */
  credited: string;
  /** Output still in flight or uncertain. Not available to new contributions. */
  reserved: string;
  /** What a new contribution may cover now. */
  remaining: string;
  /** Verified credit beyond the invoice amount. */
  excess: string;
}

/**
 * Derive an invoice's state. `credited` must be the sum of distinct, verified
 * destination credits (each settlement transaction counted once).
 */
export function summarizeInvoice(amount: string, contributions: readonly ContributionLike[], credited: string): InvoiceSummary {
  const total = BigInt(amount);
  const paid = BigInt(credited);
  let reserved = 0n;
  for (const part of contributions) if (reservesCapacity(part.state)) reserved += BigInt(part.amountOut);
  const remaining = subtractUnits(subtractUnits(amount, credited), reserved.toString());
  const has = (state: ContributionState) => contributions.some((part) => part.state === state);

  let state: InvoiceState;
  if (paid >= total) state = "paid";
  else if (has("unknown")) state = "unknown";
  else if (has("awaiting_approval")) state = "awaiting_approval";
  else if (has("processing") || has("settled")) state = "processing";
  else if (has("submitted")) state = "submitted";
  else if (paid > 0n) state = "partial";
  else if (has("quoted")) state = "quoted";
  else if (has("refunded")) state = "refunded";
  else if (has("failed")) state = "failed";
  else state = "open";

  return {
    state,
    credited: paid.toString(),
    reserved: reserved.toString(),
    remaining,
    excess: (paid > total ? paid - total : 0n).toString(),
  };
}
