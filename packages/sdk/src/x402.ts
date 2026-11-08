/**
 * x402 (HTTP 402 Payment Required) with a Wono invoice as the payment.
 *
 * Wire format follows x402 v1: a 402 body `{ x402Version, error, accepts: [PaymentRequirements] }`,
 * the client retries with an `X-PAYMENT` header (base64 JSON), and the server answers with
 * `X-PAYMENT-RESPONSE`. The scheme is `wono-invoice`: the requirement carries an invoice id, the
 * client pays that invoice with any token Wono supports (routed by Aurora Intents into USDC on
 * Solana), and the server releases the resource only after `wono.invoices.retrieve` reports
 * `paid`. Standard `exact`-scheme clients do not understand this scheme; they will skip it.
 */
import type { Invoice } from "./client.ts";
import { SOLANA_USDC } from "./assets.ts";

export const X402_VERSION = 1;
export const WONO_X402_SCHEME = "wono-invoice";

export interface X402Requirement {
  scheme: string;
  network: string;
  /** Base units of `asset`. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  /** Settlement wallet that receives the USDC. */
  payTo: string;
  maxTimeoutSeconds: number;
  /** USDC mint on Solana. */
  asset: string;
  extra?: Record<string, unknown>;
}

export interface X402PaymentRequired {
  x402Version: number;
  error: string;
  accepts: X402Requirement[];
}

export interface WonoInvoiceRequirement extends X402Requirement {
  scheme: typeof WONO_X402_SCHEME;
  extra: { invoiceId: string; checkoutUrl: string; wonoUrl: string };
}

/** Build the 402 body for a freshly created invoice. */
export function paymentRequired(invoice: Invoice, options: { resource: string; wonoUrl: string; description?: string; mimeType?: string; error?: string }): X402PaymentRequired {
  const wonoUrl = options.wonoUrl.replace(/\/+$/, "");
  const expires = invoice.expiresAt ? Math.max(60, Math.floor((Date.parse(invoice.expiresAt) - Date.now()) / 1000)) : 3600;
  const requirement: WonoInvoiceRequirement = {
    scheme: WONO_X402_SCHEME,
    network: "solana",
    maxAmountRequired: invoice.amount,
    resource: options.resource,
    description: options.description ?? invoice.description ?? "Payment required",
    mimeType: options.mimeType ?? "application/json",
    payTo: invoice.recipient,
    maxTimeoutSeconds: expires,
    asset: SOLANA_USDC.mint,
    extra: { invoiceId: invoice.id, checkoutUrl: `${wonoUrl}/pay/${encodeURIComponent(invoice.id)}`, wonoUrl },
  };
  return { x402Version: X402_VERSION, error: options.error ?? "X-PAYMENT header is required", accepts: [requirement] };
}

/** The Wono requirement in a 402 body, if the server offers one. */
export function findWonoRequirement(body: unknown): WonoInvoiceRequirement | undefined {
  const accepts = (body as Partial<X402PaymentRequired> | undefined)?.accepts;
  if (!Array.isArray(accepts)) return undefined;
  return accepts.find(
    (entry): entry is WonoInvoiceRequirement =>
      entry?.scheme === WONO_X402_SCHEME &&
      typeof entry.extra?.invoiceId === "string" &&
      typeof entry.extra?.wonoUrl === "string" &&
      typeof entry.maxAmountRequired === "string",
  );
}

/** `X-PAYMENT` header value proving which invoice the client paid. */
export function encodePaymentHeader(invoiceId: string): string {
  return toBase64(JSON.stringify({ x402Version: X402_VERSION, scheme: WONO_X402_SCHEME, network: "solana", payload: { invoiceId } }));
}

/** Read an `X-PAYMENT` header. Returns the invoice id, or undefined for anything else. */
export function decodePaymentHeader(value: string | null | undefined): { invoiceId: string } | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const data = JSON.parse(fromBase64(value)) as { x402Version?: unknown; scheme?: unknown; payload?: { invoiceId?: unknown } };
    if (data.x402Version !== X402_VERSION || data.scheme !== WONO_X402_SCHEME) return undefined;
    const invoiceId = data.payload?.invoiceId;
    return typeof invoiceId === "string" && /^inv_[A-Za-z0-9_-]{1,64}$/.test(invoiceId) ? { invoiceId } : undefined;
  } catch {
    return undefined;
  }
}

export interface X402SettlementResponse {
  success: boolean;
  /** Solana signature of the verified USDC credit. */
  transaction: string;
  network: string;
  invoiceId: string;
}

/** `X-PAYMENT-RESPONSE` header for a verified (paid) invoice. */
export function encodePaymentResponse(invoice: Invoice): string {
  const response: X402SettlementResponse = { success: invoice.state === "paid", transaction: invoice.settlements[0]?.signature ?? "", network: "solana", invoiceId: invoice.id };
  return toBase64(JSON.stringify(response));
}

export function decodePaymentResponse(value: string | null | undefined): X402SettlementResponse | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(fromBase64(value)) as X402SettlementResponse;
  } catch {
    return undefined;
  }
}

function toBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function fromBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}
