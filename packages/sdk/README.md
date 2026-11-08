# @wono/sdk

Zero-dependency TypeScript for invoice payments over Aurora Intents.

```ts
import { AuroraClient, SOLANA_USDC, readStatus, summarizeInvoice, verifySolanaTokenCredit, createJsonRpc } from "@wono/sdk";

const aurora = new AuroraClient({ apiKey: process.env.WONO_AURORA_API_KEY! });
const route = {
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  destinationAsset: SOLANA_USDC.assetId,
  amountOut: "12000000",             // exact USDC the merchant receives (base units)
  recipient: merchantSolanaWallet,
  refundTo: payerBaseAddress.toLowerCase(),
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  slippageBps: 50,
};
const preview = await aurora.dryQuote(route);       // reserves nothing
const deposit = await aurora.depositQuote(route);   // not idempotent: persist before showing
const observation = await aurora.observe(deposit);  // throws QUOTE_MISMATCH for foreign data
const credit = await verifySolanaTokenCredit(createJsonRpc(solanaRpcUrl), {
  signature: observation.destinationTxHashes[0]!, mint: SOLANA_USDC.mint, owner: merchantSolanaWallet,
});
```

- `bindQuote` / `readStatus`: every requested field must be echoed unchanged; provider
  extras (referral, app fees) are tolerated. Aurora's returned refund deadline is days
  after the requested one; that is accepted as long as it is in the future.
- `applyObservation` / `summarizeInvoice`: contribution and invoice state machine.
  Uncertain and in-flight outputs are reserved, never re-offered.
- `verifySolanaTokenCredit`: finalized, successful, net credit of mint to owner.
- Amount helpers use bigint; `formatUnits` truncates and never rounds up.

The SDK does not sign, send, store, or retry anything.
