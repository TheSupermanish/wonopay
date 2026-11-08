/**
 * An autonomous agent that buys API calls with x402 + Wono (@wono/x402).
 *
 *   AGENT_KEYPAIR=~/.config/solana/agent.json node examples/agent/agent.ts http://127.0.0.1:3091/api/report --wono http://127.0.0.1:3080
 *
 * 1. Calls the API and gets HTTP 402 with a Wono invoice (price in USDC, settles on Solana).
 * 2. Picks what it holds: Solana USDC goes direct; SOL (or another Solana token) is routed by
 *    Aurora Intents into USDC for the merchant.
 * 3. Wono builds the exact transfer; the agent checks it, signs it with its own key, and Wono
 *    broadcasts it and verifies the USDC credit on Solana.
 * 4. Retries the call with X-PAYMENT and gets the data.
 *
 * Flags: --pay-with SOL|USDC|<symbol>  --max-usdc 5  --wono <Wono URL to trust, default https://wono.fi>
 *        --dry-run (quote only; nothing reserved or signed)
 * The key file is a solana-keygen JSON array. It never leaves this process.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";
import { decodePaymentResponse, formatUnits, SOLANA_USDC, WONO_URL } from "@wono/sdk";
import { wonoFetch, type WonoFetchEvent } from "@wono/x402";
import { solanaKeypairSigner } from "@wono/x402/solana";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const url = args.find((arg) => /^https?:\/\//.test(arg) && args[args.indexOf(arg) - 1] !== "--wono");
const dryRun = args.includes("--dry-run");
const payWith = flag("pay-with");
const maxUsdc = flag("max-usdc") ?? "5";
const trustedWono = flag("wono") ?? process.env.WONO_URL ?? WONO_URL;
if (!url) {
  console.error("Usage: node examples/agent/agent.ts <api-url> [--wono http://127.0.0.1:3080] [--pay-with SOL] [--max-usdc 5] [--dry-run]");
  process.exit(2);
}

const say = (icon: string, text: string) => console.log(`${icon}  ${text}`);

function loadKeypair(): Keypair {
  const path = (process.env.AGENT_KEYPAIR ?? "").replace(/^~(?=\/)/, homedir());
  if (!path) throw new Error("Set AGENT_KEYPAIR to a solana-keygen JSON key file for the agent's wallet.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

function log(event: WonoFetchEvent): void {
  switch (event.type) {
    case "requirement": {
      const { requirement } = event;
      say("$", `402 Payment Required: ${formatUnits(requirement.maxAmountRequired, SOLANA_USDC.decimals)} USDC for "${requirement.description}"`);
      say(" ", `invoice ${requirement.extra.invoiceId} · pays ${requirement.payTo} on Solana`);
      return;
    }
    case "option": {
      const { token, amountIn, held, direct, feeUsd, error } = event.option;
      if (error) return say("·", `${token.symbol}: ${error}`);
      const route = direct ? "direct, no fee" : `via Aurora Intents${feeUsd !== undefined ? `, fee ~$${feeUsd.toFixed(3)}` : ""}`;
      return say("·", `${token.symbol}: needs ${formatUnits(amountIn!, token.decimals)} ${token.symbol} (${route}); holds ${formatUnits(held, token.decimals)}`);
    }
    case "chosen":
      return say("✓", `paying with ${event.option.token.symbol}${event.option.direct ? " (direct)" : " (routed by Aurora Intents)"}`);
    case "dry-run":
      return say("■", "dry run: nothing reserved, nothing signed.");
    case "pay": {
      const pay = event.event;
      if (pay.type === "reserved") say("⇄", `route reserved: ${formatUnits(pay.contribution.amountIn ?? "0", pay.contribution.decimals)} ${pay.contribution.symbol}${pay.contribution.depositAddress ? ` → Aurora deposit ${pay.contribution.depositAddress}` : " → merchant"}`);
      if (pay.type === "signed") say("✍", "signed with the agent's key; Wono checks and broadcasts it");
      if (pay.type === "status") say("…", `invoice ${pay.invoiceState} · route ${pay.contributionState}`);
      return;
    }
    case "paid":
      return say("✓", `paid · verified on Solana ${event.invoice.settlements[0]?.url ?? ""}`);
    case "retry":
      return say("→", `GET ${url} with X-PAYMENT`);
  }
}

async function main(): Promise<void> {
  const keypair = loadKeypair();
  const signer = solanaKeypairSigner(keypair);
  say("→", `GET ${url}`);
  say("◎", `agent wallet ${signer.address} · trusts Wono at ${trustedWono}`);
  const pay = wonoFetch({ ...signer, maxUsdc, trustedWonoUrls: [trustedWono], dryRun, onEvent: log, ...(payWith ? { payWith } : {}) });
  const response = await pay(url!, { headers: { accept: "application/json" } });
  if (dryRun && response.status === 402) return;
  const receipt = decodePaymentResponse(response.headers.get("x-payment-response"));
  say(response.ok ? "✓" : "✗", `${response.status}${receipt ? ` · settlement ${receipt.transaction}` : ""}`);
  console.log(await response.text());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  say("✗", message);
  if (/trustedWonoUrls/.test(message)) say(" ", "Pass --wono <that URL> if you trust it (e.g. --wono http://127.0.0.1:3080 for a local Wono).");
  process.exit(1);
});
