import { merchantById } from "@/lib/server/auth.ts";
import { body, handle, json } from "@/lib/server/http.ts";
import { invoiceRow, invoiceView } from "@/lib/server/invoices.ts";
import { createAttempt } from "@/lib/server/payments.ts";

/** Reserve and persist deposit routes. Idempotent per client attempt key. */
export async function POST(request: Request, context: RouteContext<"/api/pay/[invoiceId]/attempts">) {
  return handle(async () => {
    const { invoiceId } = await context.params;
    const input = await body(request);
    const result = await createAttempt(invoiceId, String(input.key ?? ""), input.parts);
    const invoice = (await invoiceRow(invoiceId))!;
    const merchant = await merchantById(invoice.merchant_id);
    return json(
      { ...result, invoice: await invoiceView(invoice, merchant?.storeName ?? "Merchant") },
      result.status === "ready" ? 201 : 422,
    );
  });
}
