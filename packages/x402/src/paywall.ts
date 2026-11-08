/**
 * Server side: put any Fetch-API route behind HTTP 402 with a Wono invoice.
 *
 *   const paid = wonoPaywall({ wono, price: "0.25", description: "Weather report" });
 *   export const GET = paid(async (request, { invoice }) => Response.json(await report()));
 *
 * Works with Next.js route handlers, Hono (`(c) => handler(c.req.raw)`), Bun, Deno, and anything
 * else that maps a Request to a Response. The resource is released only when Wono reports the
 * invoice `paid` (finalized USDC credit on Solana, verified by Wono), the invoice was created for
 * this resource, and it has not been redeemed before.
 */
import { decodePaymentHeader, encodePaymentResponse, paymentRequired, WonoError, type Invoice, type Wono } from "@wono/sdk";

/**
 * Records which invoices have been spent. `claim` must be atomic: return true only for the first
 * caller of an id. The default keeps ids in memory, which forgets them on restart and does not
 * share them across instances; use your database in production (e.g. INSERT ... ON CONFLICT DO NOTHING).
 */
export interface RedeemedStore {
  claim(invoiceId: string): boolean | Promise<boolean>;
  /** Undo a claim when the handler fails, so the payer can retry. Optional. */
  release?(invoiceId: string): void | Promise<void>;
}

export function memoryStore(): RedeemedStore {
  const ids = new Set<string>();
  return {
    claim: (id) => (ids.has(id) ? false : (ids.add(id), true)),
    release: (id) => void ids.delete(id),
  };
}

export interface PaywallOptions {
  /** Server-side Wono client (holds your secret key), or a function returning it so it is created on first call. */
  wono: WonoServer | (() => WonoServer);
  /** USDC price per call as a decimal string, e.g. "0.25". */
  price: string;
  description?: string;
  mimeType?: string;
  /** Wono deployment the client pays through. Defaults to `wono.baseUrl`. */
  wonoUrl?: string;
  /** How long an unpaid invoice stays open. Default 1 hour. */
  expiresInHours?: number;
  store?: RedeemedStore;
  /** Canonical URL of the resource. Default: proto + host from forwarding headers, plus the path. */
  resource?: (request: Request) => string;
}

type WonoServer = Pick<Wono, "invoices" | "baseUrl">;

export interface PaidContext {
  /** The verified, paid invoice this call redeemed. */
  invoice: Invoice;
}

export type PaidHandler<A extends unknown[]> = (request: Request, paid: PaidContext, ...rest: A) => Response | Promise<Response>;

/** Binds an invoice to a resource: its reference starts with a hash of the URL. */
export async function resourceTag(resource: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resource)));
  return `x402:${hex(digest).slice(0, 16)}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What the client called. Next may report its bind address in request.url, so prefer the headers. */
export function requestResource(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}`;
}

export function wonoPaywall(options: PaywallOptions) {
  const store = options.store ?? memoryStore();
  const resourceOf = options.resource ?? requestResource;
  const client = () => (typeof options.wono === "function" ? options.wono() : options.wono);

  const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

  async function demand(resource: string, error?: string, existing?: Invoice): Promise<Response> {
    const wono = client();
    const wonoUrl = (options.wonoUrl ?? wono.baseUrl).replace(/\/+$/, "");
    const invoice =
      existing ??
      (await wono.invoices.create({
        amount: options.price,
        ...(options.description ? { description: options.description } : {}),
        reference: `${await resourceTag(resource)}:${hex(crypto.getRandomValues(new Uint8Array(8)))}`,
        expiresInHours: options.expiresInHours ?? 1,
      }));
    return json(
      paymentRequired(invoice, {
        resource,
        wonoUrl,
        ...(options.description ? { description: options.description } : {}),
        ...(options.mimeType ? { mimeType: options.mimeType } : {}),
        ...(error ? { error } : {}),
      }),
      402,
    );
  }

  return function protect<A extends unknown[]>(handler: PaidHandler<A>) {
    return async (request: Request, ...rest: A): Promise<Response> => {
      const resource = resourceOf(request);
      const payment = decodePaymentHeader(request.headers.get("x-payment"));
      if (!payment) return demand(resource);

      let invoice: Invoice;
      try {
        invoice = await client().invoices.retrieve(payment.invoiceId, { refresh: true });
      } catch (error) {
        if (error instanceof WonoError && error.status === 404) return demand(resource, "Unknown invoice.");
        throw error;
      }
      if (!invoice.reference?.startsWith(`${await resourceTag(resource)}:`)) return demand(resource, "That invoice is for a different resource.");
      if (invoice.state !== "paid") return demand(resource, `Invoice ${invoice.state}; not paid yet.`, invoice);
      if (!(await store.claim(invoice.id))) return demand(resource, "That invoice was already used.");

      let response: Response;
      try {
        response = await handler(request, { invoice }, ...rest);
      } catch (error) {
        await store.release?.(invoice.id);
        throw error;
      }
      // Copy so the header can be set even on an immutable Response (e.g. one from fetch).
      const headers = new Headers(response.headers);
      headers.set("x-payment-response", encodePaymentResponse(invoice));
      headers.set("access-control-expose-headers", "x-payment-response");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
  };
}
