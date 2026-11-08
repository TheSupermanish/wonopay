import { wonoPaywall } from "@wono/x402";
import { wono, WONO_URL } from "@/lib/wono";

/**
 * A paid API for agents, using x402 with a Wono invoice (see @wono/x402):
 *   1. GET without X-PAYMENT → 402 with an invoice to pay (any token, settles as USDC on Solana).
 *   2. The agent pays the invoice, then retries with X-PAYMENT naming it.
 *   3. The paywall asks Wono for the invoice; only `paid` (verified on Solana) releases the data.
 */
export const dynamic = "force-dynamic";

// Redeemed invoice ids are kept in memory by default; pass `store` to persist them in production.
const paid = wonoPaywall({
  wono,
  price: process.env.REPORT_PRICE ?? "1.00",
  description: "Token price snapshot (pay-per-call API)",
  wonoUrl: WONO_URL,
});

export const GET = paid(async (_request, { invoice }) => Response.json({ paidWith: invoice.id, ...(await snapshot()) }, { headers: { "cache-control": "no-store" } }));

/** The paid content: live prices from Wono's token catalog (Aurora Intents). */
async function snapshot() {
  const response = await fetch(`${WONO_URL}/api/tokens`, { cache: "no-store" });
  const { tokens } = (await response.json()) as { tokens: { symbol: string; chainName: string; price?: number; priceUpdatedAt?: string }[] };
  const wanted = new Set(["SOL", "ETH", "BTC", "USDC", "BNB", "POL", "AVAX"]);
  const seen = new Set<string>();
  const prices = tokens
    .filter((token) => wanted.has(token.symbol) && token.price !== undefined && !seen.has(token.symbol) && seen.add(token.symbol))
    .map((token) => ({ symbol: token.symbol, usd: token.price, chain: token.chainName, updatedAt: token.priceUpdatedAt }));
  return { source: "Aurora Intents token catalog via Wono", prices };
}
