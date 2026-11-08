import { body, handle, json } from "@/lib/server/http.ts";
import { reportOutcome, type WalletOutcome } from "@/lib/server/payments.ts";

export async function POST(request: Request, context: RouteContext<"/api/pay/contributions/[contributionId]/outcome">) {
  return handle(async () => {
    const { contributionId } = await context.params;
    const input = await body(request);
    const ids = Array.isArray(input.contributionIds) ? input.contributionIds : [contributionId];
    const state = await reportOutcome(ids, String(input.key ?? ""), input.outcome as WalletOutcome);
    return json({ state });
  });
}
