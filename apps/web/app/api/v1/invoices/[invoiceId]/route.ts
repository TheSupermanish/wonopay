import { merchantByApiKey } from "@/lib/server/auth.ts";
import { handle, json } from "@/lib/server/http.ts";
import { invoiceForMerchant, invoiceView, UserError } from "@/lib/server/invoices.ts";
import { reconcileInvoice } from "@/lib/server/payments.ts";

/**
 * Server-to-server: authoritative invoice state. Fulfil only when `state` is "paid";
 * that requires verified, finalized USDC credits to your settlement wallet.
 * Add `?refresh=1` to reconcile with Aurora and Solana first.
 */
export async function GET(request: Request, context: RouteContext<"/api/v1/invoices/[invoiceId]">) {
  return handle(async () => {
    const merchant = await merchantByApiKey(request.headers.get("authorization"));
    if (!merchant) throw new UserError("Invalid API key.", 401);
    const { invoiceId } = await context.params;
    let invoice = await invoiceForMerchant(merchant.id, invoiceId);
    if (!invoice) throw new UserError("Invoice not found.", 404);
    if (new URL(request.url).searchParams.get("refresh") === "1") invoice = await reconcileInvoice(invoiceId);
    return json(await invoiceView(invoice, merchant.storeName, { includeUnsent: true }));
  });
}
