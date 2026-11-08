// Live, read-only probe: token catalog plus dry quotes. Moves no funds, prints no key.
// Usage: WONO_AURORA_API_KEY=… npm run probe -- <merchant-solana-address> <refund-evm-address> <refund-solana-address>
import { AuroraClient, findSolanaUsdc, formatUnits, SOLANA_USDC, WonoError } from "../src/index.ts";

const key = process.env.WONO_AURORA_API_KEY;
const [merchant, refundEvm, refundSol] = process.argv.slice(2);
if (!key || !merchant || !refundEvm || !refundSol) {
  console.error("Set WONO_AURORA_API_KEY and pass <merchant-solana> <refund-evm> <refund-solana>.");
  process.exit(1);
}
const aurora = new AuroraClient({ apiKey: key });
try {
  const tokens = await aurora.getTokens();
  const usdc = findSolanaUsdc(tokens);
  console.log(`catalog: ${tokens.length} tokens; Solana USDC ${usdc.assetId} mint ${usdc.contractAddress}`);
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
  const legs = [
    { originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", amountOut: "12000000", refundTo: refundEvm.toLowerCase(), label: "Base USDC" },
    { originAsset: "nep141:sol.omft.near", amountOut: "8000000", refundTo: refundSol, label: "SOL" },
  ];
  for (const leg of legs) {
    const quote = await aurora.dryQuote({ ...leg, destinationAsset: SOLANA_USDC.assetId, recipient: merchant, deadline, slippageBps: 50 });
    console.log(`${leg.label}: pay ${quote.amountIn} base units (~$${quote.amountInUsd}) -> ${formatUnits(quote.amountOut, 6)} USDC; withdrawFee ${quote.withdrawFee}`);
  }
} catch (error) {
  console.error(error instanceof WonoError ? `${error.code}: ${error.message}` : "Probe failed.");
  process.exitCode = 1;
}
