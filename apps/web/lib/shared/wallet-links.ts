/**
 * Links that reopen a checkout page inside a wallet app's own browser, where that wallet is
 * injected and can connect. Used on phones and in browsers with no wallet extension.
 * Formats follow each wallet's published universal-link docs.
 */

export interface WalletAppLink {
  key: string;
  name: string;
  chains: string[];
  href: string;
}

/** Wallet apps cannot open loopback or private addresses from a phone. */
export function isPublicUrl(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    host = parsed.hostname;
  } catch {
    return false;
  }
  return !(host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[)/.test(host));
}

export function walletAppLinks(pageUrl: string): WalletAppLink[] {
  const url = encodeURIComponent(pageUrl);
  const ref = encodeURIComponent(new URL(pageUrl).origin);
  return [
    { key: "phantom", name: "Phantom", chains: ["Solana", "EVM"], href: `https://phantom.app/ul/browse/${url}?ref=${ref}` },
    { key: "solflare", name: "Solflare", chains: ["Solana"], href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` },
    { key: "metamask", name: "MetaMask", chains: ["EVM"], href: `https://metamask.app.link/dapp/${pageUrl.replace(/^https?:\/\//, "")}` },
    { key: "coinbase", name: "Coinbase Wallet", chains: ["EVM"], href: `https://go.cb-w.com/dapp?cb_url=${url}` },
  ];
}
