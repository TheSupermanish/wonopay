/**
 * Payer client for Wono's public checkout API: what the hosted checkout does, for code.
 * Used by agents and scripts that pay invoices from their own wallet.
 *
 * Holds no keys. Signing happens in the caller's `sign` callback; Wono builds the exact transfer
 * (direct USDC, or a deposit into a reserved Aurora route), checks the signed bytes match it, then
 * broadcasts. Paid still means a finalized USDC credit on Solana verified by Wono.
 */
import { WONO_URL, type Invoice, type InvoiceContribution } from "./client.ts";
import { WonoError } from "./errors.ts";

export interface PayToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  contractAddress?: string;
  price?: number;
  chainName: string;
  kind: "solana" | "evm";
  chainId: number | null;
}

export interface PayPart {
  assetId: string;
  /** USDC base units this token should deliver. */
  amountOut: string;
  sourceAddress: string;
}

export interface QuotePreview {
  amountIn: string;
  amountOut: string;
  direct?: boolean;
  amountInUsd?: string;
  amountOutUsd?: string;
  [key: string]: unknown;
}

export type QuoteResult = { assetId: string; ok: true; quote: QuotePreview } | { assetId: string; ok: false; error: string };
export type BalanceResult = { assetId: string; status: "ok"; amount: string } | { assetId: string; status: "error"; message: string };

export interface AttemptResult {
  attemptId: string;
  status: "ready" | "failed" | "preparing";
  error: string | null;
  invoice: Invoice;
}

export type SolanaApprovalRequest = { kind: "solana"; method: "signTransaction"; transaction: string; lastValidBlockHeight: number };

export type WalletOutcome =
  | { type: "declined"; reason?: string }
  | { type: "solana_signed"; signedTransaction: string }
  | { type: "sent"; txHash: string }
  | { type: "uncertain"; reason?: string };

export interface PayWithSolanaInput {
  invoiceId: string;
  /** Token to pay with. Solana USDC goes direct; anything else is routed by Aurora Intents. */
  assetId: string;
  /** The paying wallet. */
  address: string;
  /** Sign (do not send) the base64 legacy transaction Wono built; return base64 signed bytes. */
  sign: (transaction: string) => Promise<string>;
  /** Refuse to sign if the reserved route costs more than this (token base units). */
  maxAmountIn?: string;
  /** Called with progress for logs. */
  onEvent?: (event: PayEvent) => void;
  /** How long to wait for verification. Default 10 minutes. */
  timeoutMs?: number;
  pollMs?: number;
}

export type PayEvent =
  | { type: "quoted"; quote: QuotePreview }
  | { type: "reserved"; attemptId: string; contribution: InvoiceContribution }
  | { type: "signed" }
  | { type: "submitted"; state: string }
  | { type: "status"; invoiceState: string; contributionState: string };

export interface WonoPayOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class WonoPay {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: WonoPayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? WONO_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  invoice(id: string): Promise<Invoice> {
    return this.#call(`/api/pay/${encodeURIComponent(id)}`);
  }

  refresh(id: string): Promise<Invoice> {
    return this.#call(`/api/pay/${encodeURIComponent(id)}/refresh`, {});
  }

  async tokens(): Promise<PayToken[]> {
    return (await this.#call<{ tokens: PayToken[] }>("/api/tokens")).tokens;
  }

  async balances(blockchain: string, address: string): Promise<BalanceResult[]> {
    return (await this.#call<{ balances: BalanceResult[] }>("/api/balances", { blockchain, address })).balances;
  }

  /** Indicative prices; reserves nothing and returns no deposit address. */
  async quote(invoiceId: string, parts: PayPart[]): Promise<QuoteResult[]> {
    return (await this.#call<{ quotes: QuoteResult[] }>(`/api/pay/${encodeURIComponent(invoiceId)}/quote`, { parts })).quotes;
  }

  /** Reserve routes. Reusing `key` returns the same attempt. Parts must cover the remaining amount exactly. */
  attempt(invoiceId: string, key: string, parts: PayPart[]): Promise<AttemptResult> {
    return this.#call(`/api/pay/${encodeURIComponent(invoiceId)}/attempts`, { key, parts }, [422]);
  }

  approval(contributionIds: string[], key: string, from: string, method: "signTransaction"): Promise<SolanaApprovalRequest> {
    return this.#call(`/api/pay/contributions/${encodeURIComponent(contributionIds[0] ?? "")}/approval`, { contributionIds, key, from, method });
  }

  outcome(contributionIds: string[], key: string, outcome: WalletOutcome): Promise<{ state: string }> {
    return this.#call(`/api/pay/contributions/${encodeURIComponent(contributionIds[0] ?? "")}/outcome`, { contributionIds, key, outcome });
  }

  /**
   * Pay the whole remaining amount of an invoice with one Solana token, then wait for Wono to
   * verify the USDC credit. Never resends: a failure after signing is reported, not retried.
   */
  async payWithSolana(input: PayWithSolanaInput): Promise<Invoice> {
    const emit = input.onEvent ?? (() => {});
    const invoice = await this.invoice(input.invoiceId);
    if (invoice.state === "paid") return invoice;
    if (invoice.expired) throw new WonoError("INVALID_INPUT", "The invoice has expired.");
    const part: PayPart = { assetId: input.assetId, amountOut: invoice.remaining, sourceAddress: input.address };

    const [preview] = await this.quote(invoice.id, [part]);
    if (!preview?.ok) throw new WonoError("HTTP_ERROR", preview?.error ?? "No quote.");
    emit({ type: "quoted", quote: preview.quote });

    const key = attemptKey();
    const attempt = await this.attempt(invoice.id, key, [part]);
    if (attempt.status !== "ready") throw new WonoError("HTTP_ERROR", attempt.error ?? "Routes could not be prepared. Nothing was sent.");
    const contribution = attempt.invoice.contributions.find((row) => row.attemptId === attempt.attemptId && row.state === "quoted");
    if (!contribution) throw new WonoError("INVALID_RESPONSE", "The attempt has no route to approve.");
    emit({ type: "reserved", attemptId: attempt.attemptId, contribution });
    const ids = [contribution.id];

    if (input.maxAmountIn && contribution.amountIn && BigInt(contribution.amountIn) > BigInt(input.maxAmountIn)) {
      await this.outcome(ids, key, { type: "declined", reason: "Route costs more than the payer's limit." });
      throw new WonoError("QUOTE_MISMATCH", `Reserved route needs ${contribution.amountIn}, above the limit ${input.maxAmountIn}. Nothing was sent.`);
    }

    const request = await this.approval(ids, key, input.address, "signTransaction");
    if (request.kind !== "solana") throw new WonoError("INVALID_RESPONSE", "Expected a Solana transaction.");
    let signed: string;
    try {
      signed = await input.sign(request.transaction);
    } catch (error) {
      // Signing never broadcasts, so nothing was sent.
      await this.outcome(ids, key, { type: "declined", reason: error instanceof Error ? error.message : "Signing failed." });
      throw error;
    }
    emit({ type: "signed" });
    const submitted = await this.outcome(ids, key, { type: "solana_signed", signedTransaction: signed });
    emit({ type: "submitted", state: submitted.state });

    const deadline = Date.now() + (input.timeoutMs ?? 600_000);
    let last = "";
    for (;;) {
      const latest = await this.refresh(invoice.id);
      const mine = latest.contributions.find((row) => row.id === contribution.id);
      const marker = `${latest.state}/${mine?.state}`;
      if (marker !== last) emit({ type: "status", invoiceState: latest.state, contributionState: String(mine?.state) });
      last = marker;
      if (latest.state === "paid") return latest;
      if (mine && ["failed", "refunded", "expired", "cancelled"].includes(mine.state)) {
        throw new WonoError("HTTP_ERROR", `Payment ${mine.state}${mine.detail ? `: ${mine.detail}` : ""}`);
      }
      if (Date.now() > deadline) return latest;
      await new Promise((resolve) => setTimeout(resolve, input.pollMs ?? 5_000));
    }
  }

  async #call<T>(path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(this.baseUrl + path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
      });
    } catch (error) {
      throw new WonoError("NETWORK_ERROR", `Wono is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const data = (await response.json().catch(() => undefined)) as (T & { error?: string }) | undefined;
    if (!response.ok && !okStatuses.includes(response.status)) {
      const message = data?.error ?? `HTTP ${response.status}`;
      throw new WonoError("HTTP_ERROR", message, { status: response.status, providerMessage: message });
    }
    if (data === undefined) throw new WonoError("INVALID_RESPONSE", `Wono answered ${response.status} with a non-JSON body.`);
    return data;
  }
}

function attemptKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
