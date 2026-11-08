import { invalidInput } from "./errors.ts";

export type ChainKind = "solana" | "evm";

export interface SourceChain {
  /** Aurora blockchain slug. */
  blockchain: string;
  kind: ChainKind;
  name: string;
  /** EVM chain id; absent for Solana. */
  chainId?: number;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerTx: string;
}

/**
 * Source chains whose wallets Wono can drive directly: Solana via Wallet Standard and
 * EVM chains via EIP-1193 / EIP-6963. Other Aurora chains are listed by the provider
 * but have no wallet integration here, so they are not offered to customers.
 */
export const SOURCE_CHAINS: readonly SourceChain[] = Object.freeze([
  { blockchain: "sol", kind: "solana", name: "Solana", nativeSymbol: "SOL", nativeDecimals: 9, explorerTx: "https://solscan.io/tx/" },
  { blockchain: "base", kind: "evm", name: "Base", chainId: 8453, nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://basescan.org/tx/" },
  { blockchain: "eth", kind: "evm", name: "Ethereum", chainId: 1, nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://etherscan.io/tx/" },
  { blockchain: "arb", kind: "evm", name: "Arbitrum", chainId: 42161, nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://arbiscan.io/tx/" },
  { blockchain: "op", kind: "evm", name: "Optimism", chainId: 10, nativeSymbol: "ETH", nativeDecimals: 18, explorerTx: "https://optimistic.etherscan.io/tx/" },
  { blockchain: "pol", kind: "evm", name: "Polygon", chainId: 137, nativeSymbol: "POL", nativeDecimals: 18, explorerTx: "https://polygonscan.com/tx/" },
  { blockchain: "bsc", kind: "evm", name: "BNB Chain", chainId: 56, nativeSymbol: "BNB", nativeDecimals: 18, explorerTx: "https://bscscan.com/tx/" },
  { blockchain: "avax", kind: "evm", name: "Avalanche", chainId: 43114, nativeSymbol: "AVAX", nativeDecimals: 18, explorerTx: "https://snowtrace.io/tx/" },
]);

export function sourceChain(blockchain: string): SourceChain | undefined {
  return SOURCE_CHAINS.find((chain) => chain.blockchain === blockchain);
}

export function requireSourceChain(blockchain: string): SourceChain {
  const chain = sourceChain(blockchain);
  if (!chain) invalidInput(`Wallet payments from ${blockchain} are not supported.`);
  return chain;
}

// ---------------------------------------------------------------------------
// Addresses

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decode base58 (Bitcoin alphabet). Returns undefined for invalid input. */
export function decodeBase58(value: string): Uint8Array | undefined {
  if (!value) return undefined;
  let number = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return undefined;
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 0xffn));
    number >>= 8n;
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function encodeBase58(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) + BigInt(byte);
  let result = "";
  while (number > 0n) {
    result = BASE58[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}

/** A base58 string that decodes to 32 bytes. Does not prove the key is on-curve. */
export function isSolanaAddress(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 44 && decodeBase58(value)?.length === 32;
}

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Canonical address form sent to Aurora so its echo can be compared exactly. */
export function normalizeAddress(kind: ChainKind, value: string): string {
  if (kind === "evm") {
    if (!isEvmAddress(value)) invalidInput("Invalid EVM address.");
    return value.toLowerCase();
  }
  if (!isSolanaAddress(value)) invalidInput("Invalid Solana address.");
  return value;
}

// ---------------------------------------------------------------------------
// EVM calldata

function word(hex: string): string {
  return hex.padStart(64, "0");
}

/** ERC-20 `transfer(address,uint256)` calldata. */
export function encodeErc20Transfer(to: string, amount: string): string {
  if (!isEvmAddress(to)) invalidInput("Invalid transfer recipient.");
  const value = BigInt(amount);
  if (value <= 0n || value >= 2n ** 256n) invalidInput("Invalid transfer amount.");
  return `0xa9059cbb${word(to.slice(2).toLowerCase())}${word(value.toString(16))}`;
}

/** ERC-20 `balanceOf(address)` calldata. */
export function encodeErc20BalanceOf(owner: string): string {
  if (!isEvmAddress(owner)) invalidInput("Invalid owner address.");
  return `0x70a08231${word(owner.slice(2).toLowerCase())}`;
}

/** Decode a single uint256 return value. */
export function decodeUint256(hex: unknown): string | undefined {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(hex)) return undefined;
  return BigInt(hex).toString();
}
