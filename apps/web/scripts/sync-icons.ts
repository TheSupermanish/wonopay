/**
 * Copy token, chain and wallet-app logos from @web3icons/core into public/icons for the tokens
 * and wallets the checkout offers, and write lib/shared/icons.ts listing what exists. Tokens
 * web3icons lacks are downloaded once here from Jupiter (Solana mints) or GeckoTerminal (by
 * contract). Logos ship with the app: checkout never loads images from third-party hosts.
 *
 *   node scripts/sync-icons.ts [tokens-url]   # default: the running app's /api/tokens
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp") as (input: Buffer) => { resize: (w: number, h: number, o: object) => { png: () => { toBuffer: () => Promise<Buffer> } } };
const { keccak_256 } = require("@noble/hashes/sha3") as { keccak_256: (input: string) => Uint8Array };

/** EIP-55 checksum address, as TrustWallet's asset folders are named. */
function checksum(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = Buffer.from(keccak_256(lower)).toString("hex");
  return `0x${[...lower].map((char, index) => (Number.parseInt(hash[index]!, 16) >= 8 ? char.toUpperCase() : char)).join("")}`;
}
// Aurora blockchain slug -> TrustWallet assets folder.
const TRUST: Record<string, string> = { eth: "ethereum", base: "base", arb: "arbitrum", op: "optimism", pol: "polygon", bsc: "smartchain", avax: "avalanchec" };
const svgRoot = join(dirname(require.resolve("@web3icons/core")), "svgs");

// Aurora blockchain slug -> web3icons network file.
const CHAINS: Record<string, string> = {
  sol: "solana",
  base: "base",
  eth: "ethereum",
  arb: "arbitrum-one",
  op: "optimism",
  pol: "polygon",
  bsc: "binance-smart-chain",
  avax: "avalanche",
};

async function svg(file: string): Promise<string> {
  const module = (await import(pathToFileURL(file).href)) as { default: string };
  return module.default;
}

const url = process.argv[2] ?? "http://127.0.0.1:3080/api/tokens";
const response = await fetch(url);
if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
const { tokens } = (await response.json()) as { tokens: { symbol: string; blockchain: string; contractAddress?: string }[] };

const branded = join(svgRoot, "tokens", "branded");
const available = new Map((await readdir(branded)).filter((name) => name.endsWith(".svg.js")).map((name) => [name.slice(0, -7).toUpperCase(), name]));

const out = join(app, "public", "icons");
await rm(out, { recursive: true, force: true });
await mkdir(join(out, "tokens"), { recursive: true });
await mkdir(join(out, "chains"), { recursive: true });
await mkdir(join(out, "wallets"), { recursive: true });

const symbols = [...new Set(tokens.map((token) => token.symbol.toUpperCase()))].sort();
const found: Record<string, string> = {};
const fileName = (symbol: string) => symbol.replace(/[^A-Z0-9]/g, "_");
for (const symbol of symbols) {
  const file = available.get(symbol);
  if (!file) continue;
  await writeFile(join(out, "tokens", `${fileName(symbol)}.svg`), await svg(join(branded, file)));
  found[symbol] = `${fileName(symbol)}.svg`;
}

// Aurora blockchain slug -> GeckoTerminal network id.
const GECKO: Record<string, string> = { sol: "solana", base: "base", eth: "eth", arb: "arbitrum", op: "optimism", pol: "polygon_pos", bsc: "bsc", avax: "avax" };
/** Image type from its first bytes; hosts often send the wrong content-type. */
function sniff(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  if (bytes.subarray(0, 3).toString() === "GIF") return "gif";
  const head = bytes.subarray(0, 512).toString("utf8").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return undefined;
}
/** IPFS links through Pinata's gateway; the public ones answer bulk downloads with 429 pages. */
function gateway(url: string): string {
  const sub = /^https:\/\/([a-z0-9]+)\.ipfs\.[^/]+(\/.*)?$/.exec(url);
  if (sub) return `https://gateway.pinata.cloud/ipfs/${sub[1]}${sub[2] ?? ""}`;
  return url.replace(/^https:\/\/[^/]+\/ipfs\//, "https://gateway.pinata.cloud/ipfs/");
}
async function geckoJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 2500 : 20000)); // ~30 calls a minute
    const response = await fetch(url);
    if (response.status === 429) continue;
    return response.ok ? response.json() : undefined;
  }
  return undefined;
}
async function logoUrl(token: { blockchain: string; contractAddress?: string }): Promise<string | undefined> {
  if (!token.contractAddress) return undefined;
  if (token.blockchain === "sol") {
    let hits: { id: string; icon?: string }[] = [];
    for (let attempt = 0; attempt < 3 && hits.length === 0; attempt++) {
      const response = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${token.contractAddress}`);
      if (response.ok) hits = (await response.json()) as typeof hits;
      else await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const icon = hits.find((hit) => hit.id === token.contractAddress)?.icon;
    if (icon) return gateway(icon);
  }
  const trust = TRUST[token.blockchain];
  if (trust) {
    const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${trust}/assets/${checksum(token.contractAddress)}/logo.png`;
    if ((await fetch(url, { method: "HEAD" })).ok) return url;
  }
  const network = GECKO[token.blockchain];
  if (!network) return undefined;
  const data = (await geckoJson(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${token.contractAddress}`)) as { data?: { attributes?: { image_url?: string | null } } } | undefined;
  const url = data?.data?.attributes?.image_url;
  return url && url !== "missing.png" && url.startsWith("https://") ? url : undefined;
}
for (const symbol of symbols.filter((symbol) => !found[symbol])) {
  // Solana tokens first: Jupiter answers without a rate limit.
  const candidates = tokens.filter((token) => token.symbol.toUpperCase() === symbol).sort((a, b) => Number(b.blockchain === "sol") - Number(a.blockchain === "sol"));
  for (const token of candidates) {
    try {
      const url = await logoUrl(token);
      if (!url) continue;
      const image = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!image.ok) continue;
      const raw = Buffer.from(await image.arrayBuffer());
      const kind = sniff(raw);
      if (!kind) continue;
      // Raster logos are normalised to a small square PNG; SVGs ship as they are.
      const bytes = kind === "svg" ? raw : await sharp(raw).resize(128, 128, { fit: "cover" }).png().toBuffer();
      const extension = kind === "svg" ? "svg" : "png";
      await writeFile(join(out, "tokens", `${fileName(symbol)}.${extension}`), bytes);
      found[symbol] = `${fileName(symbol)}.${extension}`;
      break;
    } catch {
      // Next candidate; a token without a logo keeps its monogram.
    }
  }
  if (!found[symbol]) console.log(`no logo: ${symbol}`);
}
for (const [slug, name] of Object.entries(CHAINS)) {
  await writeFile(join(out, "chains", `${slug}.svg`), await svg(join(svgRoot, "networks", "branded", `${name}.svg.js`)));
}

// Wallet apps offered by lib/shared/wallet-links.ts. Prefer the square app-icon variant.
for (const name of ["phantom", "solflare", "metamask", "coinbase"]) {
  const square = join(svgRoot, "wallets", "background", `${name}.svg.js`);
  const file = (await readdir(join(svgRoot, "wallets", "background"))).includes(`${name}.svg.js`) ? square : join(svgRoot, "wallets", "branded", `${name}.svg.js`);
  await writeFile(join(out, "wallets", `${name}.svg`), await svg(file));
}

await writeFile(
  join(app, "lib", "shared", "icons.ts"),
  `// Generated by scripts/sync-icons.ts. Do not edit.\n\n/** Logo file in public/icons/tokens per token symbol (upper case). */\nexport const TOKEN_ICONS: Readonly<Record<string, string>> = ${JSON.stringify(found)};\n\n/** Chains with a logo in public/icons/chains. */\nexport const CHAIN_ICONS: ReadonlySet<string> = new Set(${JSON.stringify(Object.keys(CHAINS))});\n`,
);
console.log(`${Object.keys(found).length}/${symbols.length} token logos, ${Object.keys(CHAINS).length} chain logos.`);
