import "server-only";
import {
  AuroraClient,
  createJsonRpc,
  decodeUint256,
  encodeErc20BalanceOf,
  findSolanaUsdc,
  isEvmAddress,
  isSolanaAddress,
  SOURCE_CHAINS,
  sourceChain,
  type JsonRpc,
  type SourceChain,
  type Token,
} from "@wono/sdk";
import { auroraApiKey, rpcUrl } from "./config.ts";

const globalStore = globalThis as unknown as {
  __wonoAurora?: AuroraClient;
  __wonoCatalog?: { tokens: Token[]; fetchedAt: number };
  __wonoRpc?: Map<string, JsonRpc>;
};

export function aurora(): AuroraClient {
  globalStore.__wonoAurora ??= new AuroraClient({ apiKey: auroraApiKey() });
  return globalStore.__wonoAurora;
}

const CATALOG_TTL_MS = 5 * 60_000;

/** Aurora's live token catalog, cached briefly in memory. */
export async function catalog(): Promise<Token[]> {
  const cached = globalStore.__wonoCatalog;
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.tokens;
  const tokens = await aurora().getTokens();
  findSolanaUsdc(tokens);
  globalStore.__wonoCatalog = { tokens, fetchedAt: Date.now() };
  return tokens;
}

export interface SourceToken extends Token {
  chain: SourceChain;
}

/** Catalog entries the checkout can pay from: a supported wallet chain and a usable contract. */
export async function sourceTokens(): Promise<SourceToken[]> {
  const tokens = await catalog();
  return tokens.flatMap((token) => {
    const chain = sourceChain(token.blockchain);
    if (!chain) return [];
    if (token.contractAddress) {
      const valid = chain.kind === "evm" ? isEvmAddress(token.contractAddress) : isSolanaAddress(token.contractAddress);
      if (!valid) return [];
    } else if (token.decimals !== chain.nativeDecimals) {
      return [];
    }
    return [{ ...token, chain }];
  });
}

export async function sourceToken(assetId: string): Promise<SourceToken | undefined> {
  return (await sourceTokens()).find((token) => token.assetId === assetId);
}

export function rpc(blockchain: string): JsonRpc {
  globalStore.__wonoRpc ??= new Map();
  let client = globalStore.__wonoRpc.get(blockchain);
  if (!client) {
    client = createJsonRpc(rpcUrl(blockchain), { timeoutMs: 15_000 });
    globalStore.__wonoRpc.set(blockchain, client);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Balances

export type BalanceResult =
  | { assetId: string; status: "ok"; amount: string }
  | { assetId: string; status: "error"; message: string };

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

interface ParsedTokenAccount {
  pubkey: string;
  account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } };
}

/** Balances of every supported token on one chain for one address. Unknown stays unknown. */
export async function readBalances(blockchain: string, address: string): Promise<BalanceResult[]> {
  const chain = SOURCE_CHAINS.find((entry) => entry.blockchain === blockchain);
  if (!chain) throw new Error("Unsupported chain.");
  const tokens = (await sourceTokens()).filter((token) => token.blockchain === blockchain);
  if (chain.kind === "solana") return readSolanaBalances(address, tokens);
  return readEvmBalances(blockchain, address, tokens);
}

async function readSolanaBalances(owner: string, tokens: SourceToken[]): Promise<BalanceResult[]> {
  if (!isSolanaAddress(owner)) throw new Error("Invalid Solana address.");
  const client = rpc("sol");
  const { associatedTokenAddress } = await import("./solana-tx.ts");
  // Transfers spend from the associated token account, so read exactly those accounts
  // (classic and Token-2022 derivations). Bounded work regardless of wallet size.
  const spl = tokens.filter((token) => token.contractAddress);
  const accounts = spl.flatMap((token) => [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((program) => associatedTokenAddress(owner, token.contractAddress!, program)));
  const [native, parsed] = await Promise.allSettled([
    client.call<{ value: number }>("getBalance", [owner, { commitment: "confirmed" }]),
    client.call<{ value: (null | ParsedTokenAccount["account"])[] }>("getMultipleAccounts", [accounts, { encoding: "jsonParsed", commitment: "confirmed" }]),
  ]);
  const spendable = new Map<string, bigint>();
  if (parsed.status === "fulfilled") {
    for (const account of parsed.value?.value ?? []) {
      const info = account?.data?.parsed?.info;
      const amount = info?.tokenAmount?.amount;
      if (info?.mint && typeof amount === "string" && /^[0-9]+$/.test(amount)) spendable.set(info.mint, (spendable.get(info.mint) ?? 0n) + BigInt(amount));
    }
  }
  return tokens.map((token): BalanceResult => {
    if (!token.contractAddress) {
      return native.status === "fulfilled" && typeof native.value?.value === "number"
        ? { assetId: token.assetId, status: "ok", amount: BigInt(native.value.value).toString() }
        : { assetId: token.assetId, status: "error", message: "Solana RPC did not return a SOL balance." };
    }
    if (parsed.status !== "fulfilled" || !Array.isArray(parsed.value?.value)) return { assetId: token.assetId, status: "error", message: "Solana RPC did not return token accounts." };
    return { assetId: token.assetId, status: "ok", amount: (spendable.get(token.contractAddress) ?? 0n).toString() };
  });
}

async function readEvmBalances(blockchain: string, owner: string, tokens: SourceToken[]): Promise<BalanceResult[]> {
  if (!isEvmAddress(owner)) throw new Error("Invalid EVM address.");
  const client = rpc(blockchain);
  return Promise.all(
    tokens.map(async (token): Promise<BalanceResult> => {
      try {
        const raw = token.contractAddress
          ? await client.call<string>("eth_call", [{ to: token.contractAddress, data: encodeErc20BalanceOf(owner) }, "latest"])
          : await client.call<string>("eth_getBalance", [owner, "latest"]);
        const amount = decodeUint256(raw === "0x" ? "0x0" : raw);
        return amount === undefined
          ? { assetId: token.assetId, status: "error", message: "Unreadable balance." }
          : { assetId: token.assetId, status: "ok", amount };
      } catch {
        return { assetId: token.assetId, status: "error", message: "RPC request failed." };
      }
    }),
  );
}
