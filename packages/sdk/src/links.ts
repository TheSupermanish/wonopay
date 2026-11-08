/**
 * Keyless payments: collect for any Solana wallet with no Wono account and no API key.
 * Safe in the browser, since nothing here is secret.
 *
 *   const invoice = await createPayLink({ to: "5bPg…ci17", amount: "5", description: "Code review" });
 *   // send the customer to invoice.checkoutUrl, or open it with @wono/react
 *   const latest = await getInvoice(invoice.id, { refresh: true });
 *   if (isPaidTo(latest, { to: "5bPg…ci17", amount: "5" })) fulfil();
 *
 * Anyone can create a link that pays your wallet, so before fulfilling, check that the invoice
 * pays your wallet the amount you charge (`isPaidTo`), not just that it is paid.
 */
import { toBaseUnits } from "./amounts.ts";
import { WONO_URL, type Invoice } from "./client.ts";
import { WonoError } from "./errors.ts";

export interface PayLinkInput {
  /** Solana wallet that receives USDC. */
  to: string;
  /** USDC amount as a decimal string, e.g. "5" or "2.50". Minimum 1. */
  amount: string;
  description?: string;
  /** Your order id. */
  reference?: string;
  /** Name shown to the payer at checkout. */
  name?: string;
  expiresInHours?: number;
}

export interface PublicOptions {
  /** Wono deployment. Defaults to https://wonopay.vercel.app. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createPayLink(input: PayLinkInput, options: PublicOptions = {}): Promise<Invoice> {
  return request(options, "POST", "/api/v1/links", input);
}

/** Public invoice read. `refresh: true` reconciles with Aurora and Solana before answering. */
export function getInvoice(id: string, options: PublicOptions & { refresh?: boolean } = {}): Promise<Invoice> {
  const path = `/api/pay/${encodeURIComponent(id)}${options.refresh ? "/refresh" : ""}`;
  return request(options, options.refresh ? "POST" : "GET", path);
}

/** Paid, to this wallet, for at least this amount. Use this before fulfilling a keyless invoice. */
export function isPaidTo(invoice: Invoice, expected: { to: string; amount: string }): boolean {
  if (invoice.state !== "paid" || invoice.recipient !== expected.to) return false;
  const want = BigInt(toBaseUnits(expected.amount, invoice.decimals));
  return BigInt(invoice.amount) >= want && BigInt(invoice.credited) >= want;
}

async function request(options: PublicOptions, method: "GET" | "POST", path: string, body?: unknown): Promise<Invoice> {
  const base = (options.baseUrl ?? WONO_URL).replace(/\/+$/, "");
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await send(base + path, {
      method,
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
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
