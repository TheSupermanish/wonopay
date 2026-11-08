import "server-only";
import path from "node:path";

const RPC_DEFAULTS: Record<string, string> = {
  sol: "https://api.mainnet-beta.solana.com",
  base: "https://base-rpc.publicnode.com",
  eth: "https://ethereum-rpc.publicnode.com",
  arb: "https://arbitrum-one-rpc.publicnode.com",
  op: "https://optimism-rpc.publicnode.com",
  pol: "https://polygon-bor-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  avax: "https://avalanche-c-chain-rpc.publicnode.com",
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Aurora application key. Server-only; checkout never sees it. */
export function auroraApiKey(): string {
  const key = process.env.WONO_AURORA_API_KEY?.trim();
  if (!key) throw new ConfigurationError("WONO_AURORA_API_KEY is not set on the server.");
  return key;
}

export function databasePath(): string {
  return process.env.WONO_DATABASE_PATH?.trim() || path.join(process.cwd(), ".data", "wono.sqlite");
}

/** RPC endpoint per Aurora blockchain slug. Override with WONO_RPC_<SLUG>, e.g. WONO_RPC_SOL. */
export function rpcUrl(blockchain: string): string {
  const override = process.env[`WONO_RPC_${blockchain.toUpperCase()}`]?.trim();
  const url = override || RPC_DEFAULTS[blockchain];
  if (!url) throw new ConfigurationError(`No RPC endpoint configured for ${blockchain}.`);
  return url;
}

export function usingDefaultRpc(blockchain: string): boolean {
  return !process.env[`WONO_RPC_${blockchain.toUpperCase()}`]?.trim();
}

/** Public origin for links, e.g. https://wono.fi. Falls back to the request origin. */
export function configuredPublicOrigin(): string | undefined {
  const value = process.env.WONO_PUBLIC_URL?.trim();
  if (!value) return undefined;
  return new URL(value).origin;
}

/**
 * Secret key of the Solana wallet that pays network fees and account rent for customers
 * (base58, or a JSON byte array as written by `solana-keygen`). Optional: without it the
 * customer's wallet pays its own Solana fees. Never logged or sent to the browser.
 */
export function solanaSponsorSecret(): Uint8Array | undefined {
  const value = process.env.WONO_SOLANA_FEE_PAYER_SECRET?.trim();
  if (!value) return undefined;
  if (value.startsWith("[")) {
    const bytes = JSON.parse(value) as unknown;
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte < 256)) {
      throw new ConfigurationError("WONO_SOLANA_FEE_PAYER_SECRET must be a 64-byte secret key.");
    }
    return Uint8Array.from(bytes as number[]);
  }
  return undefined; // base58 form is decoded in solana-tx.ts, which owns the Solana libraries
}

export function solanaSponsorConfigured(): boolean {
  return Boolean(process.env.WONO_SOLANA_FEE_PAYER_SECRET?.trim());
}

/** Below this sponsor balance (lamports), customers pay their own Solana fees. */
export const SPONSOR_MIN_LAMPORTS = 10_000_000n; // 0.01 SOL
/** Highest priority fee a wallet may add to a sponsored transaction (micro-lamports per compute unit). */
export const SPONSOR_MAX_CU_PRICE = 1_000_000n;

/** Slippage applied to every route, in basis points. */
export const SLIPPAGE_BPS = 50;
/** How long a customer has to approve a prepared route in their wallet. */
export const APPROVAL_WINDOW_MS = 10 * 60_000;
/** Safety margin: no wallet prompt within this much of the window closing. */
export const APPROVAL_MARGIN_MS = 30_000;
