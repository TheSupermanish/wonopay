import { parseTokenCatalog, type Token } from "./assets.ts";
import { invalidInput, isRecord, WonoError } from "./errors.ts";
import { bindQuote, buildQuoteRequest, isDepositQuote, type BoundQuote, type DepositQuote, type RouteInput } from "./quotes.ts";
import { readStatus, type ProviderObservation } from "./status.ts";

export const AURORA_API = "https://intents-api.aurora.dev/api";

export interface AuroraClientOptions {
  /** Aurora Intents application key. Sent as a path segment; never included in errors. */
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export interface DepositSubmission {
  txHash: string;
  depositAddress: string;
  memo?: string;
}

/**
 * Thin, validating client for Aurora's Intents Swap API. It never signs or sends funds.
 * Each method either returns validated data or throws a WonoError without credentials.
 */
export class AuroraClient {
  #key: string;
  #rawKey: string;
  #fetch: typeof fetch;
  #timeout: number;
  #base: string;

  constructor(options: AuroraClientOptions) {
    const key = options.apiKey?.trim();
    if (!key) invalidInput("An Aurora Intents API key is required.");
    this.#rawKey = key;
    this.#key = encodeURIComponent(key);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeout = options.timeoutMs ?? 20_000;
    this.#base = (options.baseUrl ?? AURORA_API).replace(/\/+$/, "");
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout <= 0) invalidInput("timeoutMs must be a positive integer.");
  }

  #scrub(message: string): string {
    return message.split(this.#rawKey).join("<key>").split(this.#key).join("<key>").slice(0, 300);
  }

  async #request(path: string, init: { query?: URLSearchParams; body?: unknown } = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    const url = `${this.#base}/${path}/${this.#key}${init.query ? `?${init.query.toString()}` : ""}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: init.body === undefined ? "GET" : "POST",
        headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      clearTimeout(timer);
      // Fetch errors can include the URL, which carries the key. Never surface them.
      throw new WonoError("NETWORK_ERROR", "Aurora could not be reached.");
    }
    try {
      const body = await response.text();
      let data: unknown;
      try {
        data = body ? JSON.parse(body) : undefined;
      } catch {
        data = undefined;
      }
      if (!response.ok) {
        const raw = isRecord(data) ? (typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : undefined) : undefined;
        const message = raw ? this.#scrub(raw) : undefined;
        throw new WonoError("HTTP_ERROR", message ? `Aurora: ${message}` : `Aurora request failed (${response.status}).`, {
          status: response.status,
          ...(message ? { providerMessage: message } : {}),
        });
      }
      if (data === undefined) throw new WonoError("INVALID_RESPONSE", "Aurora returned invalid JSON.");
      return data;
    } catch (error) {
      if (error instanceof WonoError) throw error;
      throw new WonoError("NETWORK_ERROR", "Aurora response could not be read.");
    } finally {
      clearTimeout(timer);
    }
  }

  async getTokens(): Promise<Token[]> {
    return parseTokenCatalog(await this.#request("tokens"));
  }

  /** Indicative quote. Reserves nothing; amounts can change when a deposit quote is requested. */
  async dryQuote(route: RouteInput): Promise<BoundQuote> {
    const request = buildQuoteRequest(route, true);
    return bindQuote(await this.#request("quote", { body: request }), request);
  }

  /**
   * Request a deposit address for one route. Not idempotent: each call creates a new
   * route. Persist the result before showing it to a payer.
   */
  async depositQuote(route: RouteInput): Promise<DepositQuote> {
    const request = buildQuoteRequest(route, false);
    const quote = bindQuote(await this.#request("quote", { body: request }), request);
    if (!isDepositQuote(quote)) throw new WonoError("INVALID_RESPONSE", "Aurora returned no deposit instructions.");
    return quote;
  }

  /** Read and bind provider status for a saved route. Throws QUOTE_MISMATCH for foreign data. */
  async observe(saved: DepositQuote): Promise<ProviderObservation> {
    const query = new URLSearchParams({ depositAddress: saved.depositAddress });
    if (saved.depositMemo) query.set("depositMemo", saved.depositMemo);
    return readStatus(await this.#request("status", { query }), saved);
  }

  /** Tell Aurora about a broadcast deposit so it can be detected sooner. Optional. */
  async submitDeposit(submission: DepositSubmission): Promise<void> {
    await this.#request("deposit/submit", {
      body: { txHash: submission.txHash, depositAddress: submission.depositAddress, ...(submission.memo ? { memo: submission.memo } : {}) },
    });
  }
}

export function createAuroraClient(options: AuroraClientOptions): AuroraClient {
  return new AuroraClient(options);
}
