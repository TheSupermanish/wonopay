/**
 * Client side: a fetch that pays HTTP 402 `wono-invoice` requirements from the caller's wallet.
 *
 *   import { solanaKeypairSigner } from "@wono/x402/solana";
 *   const pay = wonoFetch({ ...solanaKeypairSigner(keypair), maxUsdc: "5" });
 *   const response = await pay("https://api.example.com/report");
 *
 * On a 402 it checks the price against `maxUsdc` and against the invoice Wono reports, picks a
 * token the wallet holds (Solana USDC goes direct; SOL or another Solana token is routed by Aurora
 * Intents), lets `sign` sign the exact transfer Wono built, waits for Wono to verify the USDC
 * credit on Solana, and retries once with X-PAYMENT. Holds no keys. Never resends a payment.
 */
import {
  encodePaymentHeader,
  findWonoRequirement,
  formatUnits,
  SOLANA_USDC,
  toBaseUnits,
  WONO_URL,
  WonoError,
  WonoPay,
  type Invoice,
  type PayEvent,
  type PayToken,
  type WonoInvoiceRequirement,
} from "@wono/sdk";

export interface PaymentOption {
  token: PayToken;
  /** Token base units the route needs, from the indicative quote. */
  amountIn?: string;
  /** Token base units the wallet holds. */
  held: string;
  direct: boolean;
  /** Display estimate of the route fee in USD. */
  feeUsd?: number;
  /** Why this token cannot pay, if it cannot. */
  error?: string;
  affordable: boolean;
}

export type WonoFetchEvent =
  | { type: "requirement"; requirement: WonoInvoiceRequirement; invoice: Invoice }
  | { type: "option"; option: PaymentOption }
  | { type: "chosen"; option: PaymentOption }
  | { type: "dry-run"; option: PaymentOption }
  | { type: "pay"; event: PayEvent }
  | { type: "paid"; invoice: Invoice }
  | { type: "retry"; invoiceId: string };

export interface WonoFetchOptions {
  /** The paying Solana wallet. */
  address: string;
  /** Sign (do not send) the base64 transaction Wono built; return base64 signed bytes. */
  sign: (transaction: string) => Promise<string>;
  /** Highest price this client pays per call, in USDC, e.g. "5". Required: an auto-paying fetch needs a cap. */
  maxUsdc: string | number;
  /** Pay with this token symbol only (e.g. "SOL"). Default: Solana USDC if held, else SOL. */
  payWith?: string;
  /**
   * Wono deployments this client will pay through. The 402 names one; anything else is refused,
   * because that service builds the transaction you sign. Default: https://wonopay.vercel.app.
   */
  trustedWonoUrls?: string[];
  /** Accepted price movement between the quote and the reserved route, in basis points. Default 200 (2%). */
  slippageBps?: number;
  /** Native SOL kept back for network fees when paying with SOL (lamports). Default 0.005 SOL. */
  solReserve?: bigint;
  /** Stop after choosing a token: reserve nothing, sign nothing, return the 402. */
  dryRun?: boolean;
  fetch?: typeof fetch;
  onEvent?: (event: WonoFetchEvent) => void;
  /** Passed to WonoPay.payWithSolana. */
  timeoutMs?: number;
  pollMs?: number;
}

const SOL_RESERVE = 5_000_000n;

export function wonoFetch(options: WonoFetchOptions): typeof fetch {
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const emit = options.onEvent ?? (() => {});
  const trusted = new Set((options.trustedWonoUrls ?? [WONO_URL]).map(normalize));
  const cap = BigInt(toBaseUnits(String(options.maxUsdc), SOLANA_USDC.decimals));

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // A Request body can be read once; keep a copy for the paid retry.
    const retryInput = input instanceof Request ? input.clone() : input;
    const first = await baseFetch(input, init);
    if (first.status !== 402) return first;
    const requirement = findWonoRequirement(await first.clone().json().catch(() => undefined));
    if (!requirement) return first;

    const wonoUrl = normalize(requirement.extra.wonoUrl);
    if (!trusted.has(wonoUrl)) throw new WonoError("INVALID_INPUT", `Refusing to pay through ${wonoUrl}: not in trustedWonoUrls.`);
    const pay = new WonoPay({ baseUrl: wonoUrl, fetch: baseFetch });

    // Check the invoice itself, not just what the 402 claims.
    const invoice = await pay.invoice(requirement.extra.invoiceId);
    emit({ type: "requirement", requirement, invoice });
    if (invoice.amount !== requirement.maxAmountRequired || invoice.recipient !== requirement.payTo) {
      throw new WonoError("QUOTE_MISMATCH", "The 402 does not match the invoice Wono reports. Nothing was paid.");
    }
    if (BigInt(invoice.remaining) > cap) {
      throw new WonoError("INVALID_INPUT", `Price ${formatUsdc(invoice.remaining)} USDC is above this client's limit of ${options.maxUsdc} USDC.`);
    }

    if (invoice.state !== "paid") {
      const chosen = await choose(pay, invoice, options, emit);
      if (options.dryRun) {
        emit({ type: "dry-run", option: chosen });
        return first;
      }
      const slippage = BigInt(options.slippageBps ?? 200);
      const paid = await pay.payWithSolana({
        invoiceId: invoice.id,
        assetId: chosen.token.assetId,
        address: options.address,
        sign: options.sign,
        maxAmountIn: ((BigInt(chosen.amountIn!) * (10_000n + slippage)) / 10_000n).toString(),
        onEvent: (event) => emit({ type: "pay", event }),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
      });
      if (paid.state !== "paid") {
        throw new WonoError("HTTP_ERROR", `Not verified yet (invoice ${paid.state}). Retry later with X-PAYMENT for ${paid.id}; nothing will be resent.`);
      }
      emit({ type: "paid", invoice: paid });
    }

    emit({ type: "retry", invoiceId: invoice.id });
    const headers = new Headers(init?.headers ?? (retryInput instanceof Request ? retryInput.headers : undefined));
    headers.set("x-payment", encodePaymentHeader(invoice.id));
    return baseFetch(retryInput, { ...init, headers });
  }) as typeof fetch;
}

/** Quote the candidate tokens and pick the first the wallet can cover. */
async function choose(pay: WonoPay, invoice: Invoice, options: WonoFetchOptions, emit: (event: WonoFetchEvent) => void): Promise<PaymentOption> {
  const tokens = (await pay.tokens()).filter((token) => token.blockchain === "sol");
  const wanted = options.payWith?.toUpperCase();
  const candidates = wanted
    ? tokens.filter((token) => token.symbol.toUpperCase() === wanted)
    : [tokens.find((token) => token.assetId === SOLANA_USDC.assetId), tokens.find((token) => token.symbol === "SOL")].filter((token): token is PayToken => Boolean(token));
  if (candidates.length === 0) throw new WonoError("INVALID_INPUT", `No Solana token named ${options.payWith}.`);

  const balances = new Map(
    (await pay.balances("sol", options.address)).flatMap((row) => (row.status === "ok" ? [[row.assetId, BigInt(row.amount)] as const] : [])),
  );
  let chosen: PaymentOption | undefined;
  for (const token of candidates) {
    const held = balances.get(token.assetId) ?? 0n;
    const [quote] = await pay.quote(invoice.id, [{ assetId: token.assetId, amountOut: invoice.remaining, sourceAddress: options.address }]);
    if (!quote?.ok) {
      const option: PaymentOption = { token, held: held.toString(), direct: false, error: quote?.error ?? "no route", affordable: false };
      emit({ type: "option", option });
      continue;
    }
    const { amountIn, amountInUsd, amountOutUsd } = quote.quote;
    const feeUsd = amountInUsd && amountOutUsd ? Number(amountInUsd) - Number(amountOutUsd) : undefined;
    // Native SOL also pays the network fee; keep a little back.
    const reserve = token.symbol === "SOL" ? (options.solReserve ?? SOL_RESERVE) : 0n;
    const option: PaymentOption = {
      token,
      amountIn,
      held: held.toString(),
      direct: Boolean(quote.quote.direct),
      ...(feeUsd !== undefined ? { feeUsd } : {}),
      affordable: held >= BigInt(amountIn) + reserve,
    };
    emit({ type: "option", option });
    if (!chosen && option.affordable) chosen = option;
  }
  if (!chosen) throw new WonoError("INVALID_INPUT", `Wallet ${options.address} cannot cover ${formatUsdc(invoice.remaining)} USDC. Fund it with Solana USDC or SOL.`);
  emit({ type: "chosen", option: chosen });
  return chosen;
}

function normalize(url: string): string {
  return new URL(url).origin;
}

function formatUsdc(units: string): string {
  return formatUnits(units, SOLANA_USDC.decimals);
}
