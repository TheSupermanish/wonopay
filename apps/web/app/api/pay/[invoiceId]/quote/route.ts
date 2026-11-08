import { body, handle, json } from "@/lib/server/http.ts";
import { dryQuotes } from "@/lib/server/payments.ts";

/** Indicative quotes only. Reserves nothing and returns no deposit address. */
export async function POST(request: Request, context: RouteContext<"/api/pay/[invoiceId]/quote">) {
  return handle(async () => {
    const { invoiceId } = await context.params;
    const input = await body(request);
    return json({ quotes: await dryQuotes(invoiceId, input.parts) });
  });
}
