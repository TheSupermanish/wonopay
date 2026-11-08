import { body, handle, json } from "@/lib/server/http.ts";
import { requestApproval } from "@/lib/server/payments.ts";

/** Returns the exact transfer for the payer's wallet. Each contribution is requested once. */
export async function POST(request: Request, context: RouteContext<"/api/pay/contributions/[contributionId]/approval">) {
  return handle(async () => {
    const { contributionId } = await context.params;
    const input = await body(request);
    const ids = Array.isArray(input.contributionIds) ? input.contributionIds : [contributionId];
    const method = input.method as "signTransaction" | "signAndSendTransaction" | "eth_sendTransaction";
    return json(await requestApproval(ids, String(input.key ?? ""), String(input.from ?? ""), method));
  });
}
