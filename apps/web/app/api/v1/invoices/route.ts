import { merchantByApiKey } from "@/lib/server/auth.ts";
import { body, handle, json } from "@/lib/server/http.ts";
import { createInvoice, invoiceView, UserError } from "@/lib/server/invoices.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

/** Server-to-server: create an invoice. `Authorization: Bearer wono_sk_…` */
export async function POST(request: Request) {
  return handle(async () => {
    const merchant = await merchantByApiKey(request.headers.get("authorization"));
    if (!merchant) throw new UserError("Invalid API key.", 401);
    const input = await body(request);
    const invoice = await createInvoice(merchant, {
      amount: String(input.amount ?? ""),
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(typeof input.reference === "string" ? { reference: input.reference } : {}),
      ...(typeof input.expiresInHours === "number" ? { expiresInHours: input.expiresInHours } : {}),
    });
    const origin = await publicOrigin();
    return json({ ...(await invoiceView(invoice, merchant.storeName)), checkoutUrl: `${origin}/pay/${invoice.id}` }, 201);
  });
}
