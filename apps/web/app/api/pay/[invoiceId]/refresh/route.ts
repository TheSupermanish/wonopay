import { merchantById } from "@/lib/server/auth.ts";
import { handle, json } from "@/lib/server/http.ts";
import { CORS, withCors } from "@/lib/server/links.ts";
import { invoiceRow, invoiceView, UserError } from "@/lib/server/invoices.ts";
import { reconcileInvoice } from "@/lib/server/payments.ts";

const MIN_INTERVAL_MS = 4_000;

/** Reconcile with Aurora and the chains, then return the authoritative invoice. */
export async function POST(_request: Request, context: RouteContext<"/api/pay/[invoiceId]/refresh">) {
  return withCors(await handle(async () => {
    const { invoiceId } = await context.params;
    let invoice = await invoiceRow(invoiceId);
    if (!invoice) throw new UserError("Invoice not found.", 404);
    if (!invoice.checked_at || Date.now() - Date.parse(invoice.checked_at) >= MIN_INTERVAL_MS) {
      invoice = await reconcileInvoice(invoiceId);
    }
    const merchant = await merchantById(invoice.merchant_id);
    return json(await invoiceView(invoice, merchant?.storeName ?? "Merchant"));
  }));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
