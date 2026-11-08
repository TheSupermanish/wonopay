import { merchantById } from "@/lib/server/auth.ts";
import { handle, json } from "@/lib/server/http.ts";
import { CORS, withCors } from "@/lib/server/links.ts";
import { invoiceRow, invoiceView, UserError } from "@/lib/server/invoices.ts";

export async function GET(_request: Request, context: RouteContext<"/api/pay/[invoiceId]">) {
  return withCors(await handle(async () => {
    const { invoiceId } = await context.params;
    const invoice = await invoiceRow(invoiceId);
    if (!invoice) throw new UserError("Invoice not found.", 404);
    const merchant = await merchantById(invoice.merchant_id);
    return json(await invoiceView(invoice, merchant?.storeName ?? "Merchant"));
  }));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
