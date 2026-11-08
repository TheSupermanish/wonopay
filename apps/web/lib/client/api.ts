"use client";

import type { QuotePreview } from "@/lib/server/payments.ts";
import type { InvoiceView } from "@/lib/server/invoices.ts";

export type { InvoiceView };

export interface CatalogToken {
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

export type BalanceResult = { assetId: string; status: "ok"; amount: string } | { assetId: string; status: "error"; message: string };
export type DryQuoteResult = { assetId: string; ok: true; quote: QuotePreview } | { assetId: string; ok: false; error: string };
export type WalletRequest =
  | { kind: "evm"; chainId: number; transaction: { from: string; to: string; value: string; data?: string } }
  | { kind: "solana"; method: "signTransaction" | "signAndSendTransaction"; transaction: string; lastValidBlockHeight: number };
export type WalletOutcome =
  | { type: "declined"; reason?: string }
  | { type: "solana_signed"; signedTransaction: string }
  | { type: "sent"; txHash: string }
  | { type: "uncertain"; reason?: string };

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network error. Check your connection.", 0);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !(response.status === 422 && path.endsWith("/attempts"))) {
    throw new ApiError(data.error ?? `Request failed (${response.status}).`, response.status);
  }
  return data;
}

export const api = {
  invoice: (id: string) => call<InvoiceView>(`/api/pay/${id}`),
  refresh: (id: string) => call<InvoiceView>(`/api/pay/${id}/refresh`, {}),
  tokens: () => call<{ tokens: CatalogToken[] }>("/api/tokens"),
  balances: (blockchain: string, address: string) => call<{ balances: BalanceResult[] }>("/api/balances", { blockchain, address }),
  quote: (id: string, parts: { assetId: string; amountOut: string; sourceAddress: string }[]) =>
    call<{ quotes: DryQuoteResult[] }>(`/api/pay/${id}/quote`, { parts }),
  attempt: (id: string, key: string, parts: { assetId: string; amountOut: string; sourceAddress: string }[]) =>
    call<{ attemptId: string; status: "ready" | "failed" | "preparing"; error: string | null; invoice: InvoiceView }>(`/api/pay/${id}/attempts`, { key, parts }),
  approval: (contributionIds: string[], key: string, from: string, method: string) =>
    call<WalletRequest>(`/api/pay/contributions/${contributionIds[0]}/approval`, { contributionIds, key, from, method }),
  outcome: (contributionIds: string[], key: string, outcome: WalletOutcome) =>
    call<{ state: string }>(`/api/pay/contributions/${contributionIds[0]}/outcome`, { contributionIds, key, outcome }),
};

// Per-browser convenience storage. The server remains authoritative.
export const local = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: the attempt still works in this tab.
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export function newAttemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
