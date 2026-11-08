import { isBaseUnits } from "./amounts.ts";
import { isRecord, WonoError } from "./errors.ts";

export interface JsonRpc {
  call<T = unknown>(method: string, params: unknown[]): Promise<T>;
}

export interface JsonRpcOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Minimal JSON-RPC 2.0 client. Errors never include the endpoint URL (it may carry a key). */
export function createJsonRpc(url: string, options: JsonRpcOptions = {}): JsonRpc {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;
  let id = 0;
  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await doFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
            signal: controller.signal,
            cache: "no-store",
          });
        } catch {
          throw new WonoError("NETWORK_ERROR", `RPC ${method} could not be reached.`);
        }
        if (!response.ok) throw new WonoError("RPC_ERROR", `RPC ${method} failed (${response.status}).`, { status: response.status });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new WonoError("RPC_ERROR", `RPC ${method} returned invalid JSON.`);
        }
        if (!isRecord(body)) throw new WonoError("RPC_ERROR", `RPC ${method} returned an invalid envelope.`);
        if (isRecord(body.error)) {
          const message = typeof body.error.message === "string" ? body.error.message.slice(0, 200) : "error";
          throw new WonoError("RPC_ERROR", `RPC ${method}: ${message}`, { providerMessage: message });
        }
        return body.result as T;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type CreditCheck =
  | { status: "verified"; amount: string; slot: number; blockTime?: number }
  | { status: "pending"; reason: string }
  | { status: "rejected"; reason: string };

function ownerTotal(balances: unknown, mint: string, owner: string): bigint {
  if (!Array.isArray(balances)) return 0n;
  let total = 0n;
  for (const entry of balances) {
    if (!isRecord(entry) || entry.mint !== mint || entry.owner !== owner) continue;
    const amount = isRecord(entry.uiTokenAmount) ? entry.uiTokenAmount.amount : undefined;
    if (isBaseUnits(amount)) total += BigInt(amount);
  }
  return total;
}

/**
 * Independently verify that a finalized Solana transaction succeeded and increased
 * `owner`'s balance of `mint`. Returns the net credit in base units.
 *
 * "pending" means not found at finalized commitment yet (or RPC lag). "rejected"
 * means the transaction exists but failed or credited nothing to this owner/mint.
 */
export async function verifySolanaTokenCredit(
  rpc: JsonRpc,
  input: { signature: string; mint: string; owner: string },
): Promise<CreditCheck> {
  const tx = await rpc.call<unknown>("getTransaction", [
    input.signature,
    { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 },
  ]);
  if (tx === null || tx === undefined) return { status: "pending", reason: "Transaction not finalized yet." };
  if (!isRecord(tx) || !isRecord(tx.meta)) return { status: "pending", reason: "Transaction metadata unavailable." };
  if (tx.meta.err !== null && tx.meta.err !== undefined) return { status: "rejected", reason: "Transaction failed on Solana." };
  const before = ownerTotal(tx.meta.preTokenBalances, input.mint, input.owner);
  const after = ownerTotal(tx.meta.postTokenBalances, input.mint, input.owner);
  const credit = after - before;
  if (credit <= 0n) return { status: "rejected", reason: "Transaction did not credit the merchant's token account." };
  const slot = typeof tx.slot === "number" ? tx.slot : 0;
  return {
    status: "verified",
    amount: credit.toString(),
    slot,
    ...(typeof tx.blockTime === "number" ? { blockTime: tx.blockTime } : {}),
  };
}

export type SignatureState =
  | { status: "not_found" }
  | { status: "failed"; slot: number }
  | { status: "confirmed" | "finalized" | "processed"; slot: number };

/** Look up a signature, including history beyond the recent status cache. */
export async function getSignatureState(rpc: JsonRpc, signature: string): Promise<SignatureState> {
  const result = await rpc.call<{ value?: unknown[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  const entry = result?.value?.[0];
  if (!isRecord(entry)) return { status: "not_found" };
  const slot = typeof entry.slot === "number" ? entry.slot : 0;
  if (entry.err !== null && entry.err !== undefined) return { status: "failed", slot };
  const level = entry.confirmationStatus;
  if (level === "finalized" || level === "confirmed" || level === "processed") return { status: level, slot };
  return { status: "processed", slot };
}
