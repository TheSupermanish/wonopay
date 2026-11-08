import { invalidResponse, isRecord, record, text } from "./errors.ts";

export interface Token {
  /** Aurora/NEAR Intents asset id, e.g. "nep141:sol-…omft.near". Symbols are ambiguous; ids are not. */
  assetId: string;
  /** Aurora blockchain slug: "sol", "base", "eth", "arb", … */
  blockchain: string;
  symbol: string;
  decimals: number;
  /** Token contract or mint on its origin chain. Absent for native assets. */
  contractAddress?: string;
  /** Provider USD price. Display estimates only; never used for settlement. */
  price?: number;
  priceUpdatedAt?: string;
}

/**
 * Native USDC on Solana as listed by Aurora. The app checks the live catalog still
 * maps this asset id to this mint and decimals before creating invoices.
 */
export const SOLANA_USDC = Object.freeze({
  assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  blockchain: "sol",
  symbol: "USDC",
  decimals: 6,
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
});

/** Parse Aurora's token catalog. Accepts `{ tokens, asset_stats }` (live shape) or a bare array. */
export function parseTokenCatalog(response: unknown): Token[] {
  const list = Array.isArray(response) ? response : isRecord(response) ? response.tokens : undefined;
  if (!Array.isArray(list)) invalidResponse("Expected a token list.");
  const seen = new Set<string>();
  return list.map((value) => {
    const entry = record(value, "token");
    const decimals = entry.decimals;
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      invalidResponse("Invalid token decimals.");
    }
    const token: Token = {
      assetId: text(entry.assetId, "asset id"),
      blockchain: text(entry.blockchain, "blockchain"),
      symbol: text(entry.symbol, "symbol"),
      decimals,
    };
    if (seen.has(token.assetId)) invalidResponse("Duplicate asset id in token catalog.");
    seen.add(token.assetId);
    if (typeof entry.contractAddress === "string" && entry.contractAddress.length > 0) {
      token.contractAddress = entry.contractAddress;
    }
    if (typeof entry.price === "number" && Number.isFinite(entry.price) && entry.price > 0) token.price = entry.price;
    if (typeof entry.priceUpdatedAt === "string") token.priceUpdatedAt = entry.priceUpdatedAt;
    return token;
  });
}

/** Confirm the live catalog still describes native Solana USDC the way Wono expects. */
export function findSolanaUsdc(catalog: Token[]): Token {
  const token = catalog.find((entry) => entry.assetId === SOLANA_USDC.assetId);
  if (!token) invalidResponse("Aurora no longer lists Solana USDC.");
  if (token.blockchain !== SOLANA_USDC.blockchain || token.decimals !== SOLANA_USDC.decimals || token.contractAddress !== SOLANA_USDC.mint) {
    invalidResponse("Aurora's Solana USDC listing does not match the native USDC mint.");
  }
  return token;
}
