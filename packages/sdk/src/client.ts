/**
 * Merchant API client. Runs on your server: it holds your secret key (`wono_sk_…`).
 *
 *   const wono = new Wono({ apiKey: process.env.WONO_API_KEY });
 *   const invoice = await wono.invoices.create({ amount: "25.00", reference: "order-42" });
 *   // send the customer to invoice.checkoutUrl, or embed it with @wono/react
 *   const latest = await wono.invoices.retrieve(invoice.id, { refresh: true });
 *   if (latest.state === "paid") fulfil(); // verified, finalized USDC credit on Solana
 */
import { WonoError } from "./errors.ts";
import type { ContributionState, InvoiceState } from "./settlement.ts";

export const WONO_URL = "https://wonopay.vercel.app";

export interface WonoOptions {
  /** Secret key from Dashboard → Settings → Server API key. */
  apiKey: string;
  /** Wono deployment. Defaults to https://wonopay.vercel.app. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface CreateInvoiceInput {
  /** USDC amount as a decimal string, e.g. "25" or "25.50" (up to 6 decimals). */
  amount: string;
  description?: string;
  /** Your order id. Unique per merchant; a duplicate is rejected with HTTP 409. */
  reference?: string;
  expiresInHours?: number;
}

export interface InvoiceContribution {
  id: string;
  attemptId: string;
  assetId: string;
  decimals: number;
  depositAddress?: string | null;
  state: ContributionState;
  symbol: string;
  chain: string;
  chainName: string;
  amountOut: string;
  amountIn?: string | null;
  sourceAddress: string;
  txUrl?: string | null;
  detail?: string | null;
  [key: string]: unknown;
}

export interface InvoiceSettlement {
  signature: string;
  amount: string;
  url: string;
  slot: number;
  verifiedAt: string;
}

export interface Invoice {
  id: string;
  merchantName: string;
  /** Store logo path on the Wono host (resolve against your Wono URL), or null. */
  merchantLogo?: string | null;
  description: string | null;
  reference: string | null;
  /** Base units of USDC (6 decimals). */
  amount: string;
  decimals: number;
  symbol: "USDC";
  destinationChain: "Solana";
  recipient: string;
  /** Fulfil only on "paid": finalized USDC credits to your wallet, verified by Wono. */
  state: InvoiceState;
  credited: string;
  reserved: string;
  remaining: string;
  excess: string;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  checkedAt: string | null;
  contributions: InvoiceContribution[];
  settlements: InvoiceSettlement[];
  /** Hosted checkout page. Present on create. */
  checkoutUrl?: string;
}

export class Wono {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: WonoOptions) {
    if (typeof options?.apiKey !== "string" || !options.apiKey.startsWith("wono_sk_")) {
      throw new WonoError("INVALID_INPUT", "apiKey must be a Wono secret key (wono_sk_…).");
    }
    if (typeof (globalThis as { document?: unknown }).document !== "undefined") {
      throw new WonoError("INVALID_INPUT", "The Wono client holds a secret key; use it on your server, not in the browser.");
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? WONO_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  readonly invoices = {
    create: (input: CreateInvoiceInput): Promise<Invoice> => this.#request("POST", "/api/v1/invoices", input),
    /** `refresh: true` reconciles with Aurora and Solana before answering. */
    retrieve: (id: string, options: { refresh?: boolean } = {}): Promise<Invoice> =>
      this.#request("GET", `/api/v1/invoices/${encodeURIComponent(id)}${options.refresh ? "?refresh=1" : ""}`),
  };

  /** Hosted checkout page for an invoice. */
  checkoutUrl(invoiceId: string): string {
    return `${this.baseUrl}/pay/${encodeURIComponent(invoiceId)}`;
  }

  async #request(method: "GET" | "POST", path: string, body?: unknown): Promise<Invoice> {
    let response: Response;
    try {
      response = await this.#fetch(this.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.#apiKey}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      });
    } catch (error) {
      throw new WonoError("NETWORK_ERROR", `Wono is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new WonoError("INVALID_RESPONSE", `Wono answered ${response.status} with a non-JSON body.`, { status: response.status });
    }
    if (!response.ok) {
      const message = typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : `HTTP ${response.status}`;
      throw new WonoError("HTTP_ERROR", message, { status: response.status, providerMessage: message });
    }
    const invoice = data as Invoice;
    if (typeof invoice?.id !== "string" || typeof invoice.state !== "string" || typeof invoice.amount !== "string") {
      throw new WonoError("INVALID_RESPONSE", "Wono returned an invoice without id, state or amount.");
    }
    return invoice;
  }
}
