import { baseUnits, responseUnits } from "./amounts.ts";
import { invalidInput, invalidResponse, optionalText, quoteMismatch, record, text } from "./errors.ts";

export type RecipientType = "DESTINATION_CHAIN" | "INTENTS";

/** One contribution route: exact output of the destination asset, paid from one source asset. */
export interface RouteInput {
  originAsset: string;
  destinationAsset: string;
  /** Exact destination output in destination base units. */
  amountOut: string;
  recipient: string;
  recipientType?: RecipientType;
  /** Source-chain address that receives any refund. Must be controlled by the payer. */
  refundTo: string;
  /** ISO timestamp. Wono treats this as the window in which the customer may approve. */
  deadline: string;
  slippageBps: number;
}

/** The exact body sent to Aurora. Every field is echoed back and compared. */
export interface QuoteRequestBody {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  depositType: "ORIGIN_CHAIN";
  depositMode: "SIMPLE";
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: RecipientType;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
  slippageTolerance: number;
}

export interface BoundQuote {
  request: QuoteRequestBody;
  signature: string;
  timestamp: string;
  correlationId?: string;
  amountIn: string;
  minAmountIn: string;
  maxAmountIn?: string;
  amountOut: string;
  minAmountOut: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  /** Provider-reported fees in their own units, for display. */
  refundFee?: string;
  withdrawFee?: string;
  timeEstimateSeconds?: number;
  /** Present on non-dry quotes only. */
  depositAddress?: string;
  depositMemo?: string;
  /** When the provider may begin refunding an unfulfilled deposit. */
  deadline?: string;
  /** When the deposit address stops accepting deposits. */
  timeWhenInactive?: string;
}

export interface DepositQuote extends BoundQuote {
  depositAddress: string;
  deadline: string;
}

function iso(value: string, what: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) invalidInput(`Invalid ${what}.`);
  return time;
}

export function buildQuoteRequest(route: RouteInput, dry: boolean): QuoteRequestBody {
  for (const [key, value] of Object.entries({
    originAsset: route.originAsset,
    destinationAsset: route.destinationAsset,
    recipient: route.recipient,
    refundTo: route.refundTo,
  })) {
    if (typeof value !== "string" || !value || value !== value.trim()) invalidInput(`Missing ${key}.`);
  }
  baseUnits(route.amountOut, "amountOut");
  if (!Number.isInteger(route.slippageBps) || route.slippageBps < 0 || route.slippageBps > 1_000) {
    invalidInput("slippageBps must be an integer from 0 to 1000.");
  }
  iso(route.deadline, "deadline");
  return {
    dry,
    swapType: "EXACT_OUTPUT",
    depositType: "ORIGIN_CHAIN",
    depositMode: "SIMPLE",
    originAsset: route.originAsset,
    destinationAsset: route.destinationAsset,
    amount: route.amountOut,
    recipient: route.recipient,
    recipientType: route.recipientType ?? "DESTINATION_CHAIN",
    refundTo: route.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(iso(route.deadline, "deadline")).toISOString(),
    slippageTolerance: route.slippageBps,
  };
}

/**
 * Require every requested field to be echoed unchanged. Aurora adds fields of its own
 * (referral, appFees, confidentiality); those are allowed but never replace ours.
 */
export function assertEcho(echo: unknown, request: QuoteRequestBody): void {
  const actual = record(echo, "quote request echo");
  for (const [key, expected] of Object.entries(request)) {
    const value = actual[key];
    const same = key === "deadline"
      ? typeof value === "string" && Date.parse(value) === Date.parse(expected as string)
      : value === expected;
    if (!same) quoteMismatch(`Quote does not match the requested ${key}.`);
  }
}

function usd(value: unknown): string | undefined {
  return typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value) ? value : undefined;
}

/** Validate an Aurora quote response and bind it to the exact request that produced it. */
export function bindQuote(response: unknown, request: QuoteRequestBody, now = Date.now()): BoundQuote {
  const data = record(response, "quote response");
  assertEcho(data.quoteRequest, request);
  const quote = record(data.quote, "quote");
  const bound: BoundQuote = {
    request: { ...request },
    signature: text(data.signature, "quote signature"),
    timestamp: text(data.timestamp, "quote timestamp"),
    amountIn: responseUnits(quote.amountIn, "amountIn"),
    minAmountIn: responseUnits(quote.minAmountIn, "minAmountIn"),
    amountOut: responseUnits(quote.amountOut, "amountOut"),
    minAmountOut: responseUnits(quote.minAmountOut, "minAmountOut"),
  };
  const correlationId = optionalText(data.correlationId, "correlation id");
  if (correlationId) bound.correlationId = correlationId;
  if (BigInt(bound.minAmountIn) > BigInt(bound.amountIn)) invalidResponse("Quote minimum input exceeds its input.");
  if (BigInt(bound.minAmountOut) < BigInt(request.amount) || BigInt(bound.amountOut) < BigInt(bound.minAmountOut)) {
    quoteMismatch("Quote permits less than the invoice output.");
  }
  if (quote.maxAmountIn !== undefined && quote.maxAmountIn !== null) {
    bound.maxAmountIn = responseUnits(quote.maxAmountIn, "maxAmountIn");
    if (BigInt(bound.maxAmountIn) < BigInt(bound.amountIn)) invalidResponse("Quote maximum input is below its input.");
  }
  const amountInUsd = usd(quote.amountInUsd);
  const amountOutUsd = usd(quote.amountOutUsd);
  if (amountInUsd) bound.amountInUsd = amountInUsd;
  if (amountOutUsd) bound.amountOutUsd = amountOutUsd;
  if (typeof quote.refundFee === "string" && /^[0-9]+$/.test(quote.refundFee)) bound.refundFee = quote.refundFee;
  if (typeof quote.withdrawFee === "string" && /^[0-9]+$/.test(quote.withdrawFee)) bound.withdrawFee = quote.withdrawFee;
  if (typeof quote.timeEstimate === "number" && Number.isFinite(quote.timeEstimate) && quote.timeEstimate >= 0) {
    bound.timeEstimateSeconds = quote.timeEstimate;
  }
  if (!request.dry) {
    bound.depositAddress = text(quote.depositAddress, "deposit address");
    bound.deadline = text(quote.deadline, "quote deadline");
    const deadline = Date.parse(bound.deadline);
    if (!Number.isFinite(deadline)) invalidResponse("Invalid quote deadline.");
    // Aurora returns a refund deadline days after the requested one; it must still be future.
    if (deadline <= now) invalidResponse("Provider returned an expired quote.");
    const memo = optionalText(quote.depositMemo, "deposit memo");
    if (memo) bound.depositMemo = memo;
    const inactive = optionalText(quote.timeWhenInactive, "inactive time");
    if (inactive && Number.isFinite(Date.parse(inactive))) bound.timeWhenInactive = inactive;
  }
  return bound;
}

export function isDepositQuote(quote: BoundQuote): quote is DepositQuote {
  return !quote.request.dry && typeof quote.depositAddress === "string" && typeof quote.deadline === "string";
}
