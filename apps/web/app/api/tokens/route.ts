import { handle, json } from "@/lib/server/http.ts";
import { sourceTokens } from "@/lib/server/chain.ts";

/** Live Aurora catalog, restricted to chains Wono can drive with a browser wallet. */
export async function GET() {
  return handle(async () => {
    const tokens = await sourceTokens();
    return json({
      tokens: tokens.map(({ chain, ...token }) => ({ ...token, chainName: chain.name, kind: chain.kind, chainId: chain.chainId ?? null })),
    });
  });
}
