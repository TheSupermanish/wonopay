import { SOURCE_CHAINS } from "@wono/sdk";
import { readBalances } from "@/lib/server/chain.ts";
import { body, handle, json } from "@/lib/server/http.ts";
import { UserError } from "@/lib/server/invoices.ts";

/** Read-only balances from chain RPC. Per-token errors are returned, never replaced with zero. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request);
    const blockchain = String(input.blockchain ?? "");
    if (!SOURCE_CHAINS.some((chain) => chain.blockchain === blockchain)) throw new UserError("Unsupported chain.");
    try {
      return json({ blockchain, balances: await readBalances(blockchain, String(input.address ?? "")) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid")) throw new UserError(error.message);
      throw error;
    }
  });
}
