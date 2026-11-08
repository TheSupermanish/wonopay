"use client";

/**
 * Browser wallet discovery and signing.
 *  - EVM: EIP-6963 provider discovery (MetaMask, Rabby, Coinbase Wallet, …), EIP-1193 requests.
 *  - Solana: Wallet Standard registration (Phantom, Solflare, Backpack, …).
 * Keys stay in the wallet. Wono only builds transfers and asks the wallet to approve them.
 */

// ---------------------------------------------------------------------------
// EVM

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface EvmWallet {
  kind: "evm";
  id: string;
  name: string;
  icon: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

export function discoverEvmWallets(onChange: (wallets: EvmWallet[]) => void): () => void {
  const found = new Map<string, EvmWallet>();
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.info?.rdns || !detail.provider) return;
    found.set(detail.info.rdns, { kind: "evm", id: detail.info.rdns, name: detail.info.name, icon: detail.info.icon, provider: detail.provider });
    onChange([...found.values()]);
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Legacy injected provider for wallets that predate EIP-6963.
  const timer = window.setTimeout(() => {
    const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (found.size === 0 && injected) {
      found.set("injected", { kind: "evm", id: "injected", name: "Browser wallet", icon: "", provider: injected });
      onChange([...found.values()]);
    }
  }, 600);
  return () => {
    window.removeEventListener("eip6963:announceProvider", announce);
    window.clearTimeout(timer);
  };
}

export async function connectEvm(wallet: EvmWallet): Promise<string> {
  const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts?.[0];
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("The wallet returned no account.");
  return account.toLowerCase();
}

const CHAIN_PARAMS: Record<number, { chainName: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: string[]; blockExplorerUrls: string[] }> = {
  8453: { chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] },
  42161: { chainName: "Arbitrum One", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://arb1.arbitrum.io/rpc"], blockExplorerUrls: ["https://arbiscan.io"] },
  10: { chainName: "OP Mainnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.optimism.io"], blockExplorerUrls: ["https://optimistic.etherscan.io"] },
  137: { chainName: "Polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: ["https://polygon-rpc.com"], blockExplorerUrls: ["https://polygonscan.com"] },
  56: { chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.binance.org"], blockExplorerUrls: ["https://bscscan.com"] },
  43114: { chainName: "Avalanche C-Chain", nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"], blockExplorerUrls: ["https://snowtrace.io"] },
};

export async function switchEvmChain(wallet: EvmWallet, chainId: number): Promise<void> {
  const hex = `0x${chainId.toString(16)}`;
  const current = (await wallet.provider.request({ method: "eth_chainId" })) as string;
  if (typeof current === "string" && parseInt(current, 16) === chainId) return;
  try {
    await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (error) {
    const params = CHAIN_PARAMS[chainId];
    if (errorCode(error) !== 4902 || !params) throw error;
    await wallet.provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, ...params }] });
  }
  const after = (await wallet.provider.request({ method: "eth_chainId" })) as string;
  if (parseInt(after, 16) !== chainId) throw new Error("The wallet did not switch networks.");
}

// ---------------------------------------------------------------------------
// Solana (Wallet Standard)

interface StandardAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
}

interface StandardWallet {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: Record<string, unknown>;
}

export interface SolanaWallet {
  kind: "solana";
  id: string;
  name: string;
  icon: string;
  wallet: StandardWallet;
  canSignTransaction: boolean;
  canSignAndSend: boolean;
}

const SOLANA_MAINNET = "solana:mainnet";

function asSolanaWallet(wallet: StandardWallet): SolanaWallet | undefined {
  const supportsMainnet = wallet.chains?.some((chain) => chain === SOLANA_MAINNET);
  const canSignTransaction = "solana:signTransaction" in (wallet.features ?? {});
  const canSignAndSend = "solana:signAndSendTransaction" in (wallet.features ?? {});
  if (!supportsMainnet || !("standard:connect" in wallet.features) || (!canSignTransaction && !canSignAndSend)) return undefined;
  return { kind: "solana", id: wallet.name, name: wallet.name, icon: wallet.icon, wallet, canSignTransaction, canSignAndSend };
}

export function discoverSolanaWallets(onChange: (wallets: SolanaWallet[]) => void): () => void {
  const registered = new Set<StandardWallet>();
  const emit = () => onChange([...registered].flatMap((wallet) => asSolanaWallet(wallet) ?? []));
  const api = {
    register(...wallets: StandardWallet[]) {
      wallets.forEach((wallet) => registered.add(wallet));
      emit();
      return () => {
        wallets.forEach((wallet) => registered.delete(wallet));
        emit();
      };
    },
  };
  const onRegister = (event: Event) => {
    const callback = (event as CustomEvent<(api: unknown) => void>).detail;
    if (typeof callback === "function") callback(api);
  };
  window.addEventListener("wallet-standard:register-wallet", onRegister);
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  } catch {
    // ignore
  }
  return () => window.removeEventListener("wallet-standard:register-wallet", onRegister);
}

export async function connectSolana(wallet: SolanaWallet): Promise<string> {
  const connect = wallet.wallet.features["standard:connect"] as { connect: () => Promise<{ accounts: readonly StandardAccount[] }> };
  const { accounts } = await connect.connect();
  const account = accounts.find((entry) => entry.chains?.includes(SOLANA_MAINNET)) ?? accounts[0];
  if (!account?.address) throw new Error("The wallet returned no Solana account.");
  return account.address;
}

function solanaAccount(wallet: SolanaWallet, address: string): StandardAccount {
  const account = wallet.wallet.accounts.find((entry) => entry.address === address);
  if (!account) throw new Error("The connected Solana account changed. Reconnect the wallet.");
  return account;
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
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

/** Ask the wallet to sign (not send). Returns base64 signed bytes for Wono to broadcast. */
export async function solanaSignTransaction(wallet: SolanaWallet, address: string, transaction: string): Promise<string> {
  const feature = wallet.wallet.features["solana:signTransaction"] as {
    signTransaction: (...inputs: { account: StandardAccount; transaction: Uint8Array; chain: string }[]) => Promise<{ signedTransaction: Uint8Array }[]>;
  };
  const [output] = await feature.signTransaction({ account: solanaAccount(wallet, address), transaction: fromBase64(transaction), chain: SOLANA_MAINNET });
  if (!output?.signedTransaction) throw new Error("The wallet returned no signed transaction.");
  return toBase64(output.signedTransaction);
}

/** Fallback for wallets without signTransaction: the wallet broadcasts and returns the signature. */
export async function solanaSignAndSend(wallet: SolanaWallet, address: string, transaction: string): Promise<string> {
  const feature = wallet.wallet.features["solana:signAndSendTransaction"] as {
    signAndSendTransaction: (...inputs: { account: StandardAccount; transaction: Uint8Array; chain: string }[]) => Promise<{ signature: Uint8Array }[]>;
  };
  const [output] = await feature.signAndSendTransaction({ account: solanaAccount(wallet, address), transaction: fromBase64(transaction), chain: SOLANA_MAINNET });
  if (!output?.signature) throw new Error("The wallet returned no signature.");
  return base58(output.signature);
}

// ---------------------------------------------------------------------------

export function errorCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "number") {
    return (error as { code: number }).code;
  }
  return undefined;
}

/** EIP-1193 4001: the user rejected the request. Nothing was sent. */
export function isUserRejection(error: unknown): boolean {
  return errorCode(error) === 4001;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 200);
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message.slice(0, 200);
  }
  return "The wallet reported an error.";
}
