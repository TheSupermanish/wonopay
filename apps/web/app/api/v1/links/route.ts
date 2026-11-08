import { body, handle, json } from "@/lib/server/http.ts";
import { invoiceView, UserError } from "@/lib/server/invoices.ts";
import { allowLinkCreate, CORS, createLink, withCors } from "@/lib/server/links.ts";
import { publicOrigin } from "@/lib/server/origin.ts";

/**
 * Keyless payment link: `{ to, amount, description?, reference?, name?, expiresInHours? }`.
 * No account or API key. Callable from a browser.
 */
export async function POST(request: Request) {
  return withCors(
    await handle(async () => {
      if (!allowLinkCreate(request)) throw new UserError("Too many links from this address. Try again in a few minutes.", 429);
      const { invoice, merchant } = await createLink(await body(request));
      const origin = await publicOrigin();
      return json({ ...(await invoiceView(invoice, merchant.storeName)), checkoutUrl: `${origin}/pay/${invoice.id}` }, 201);
    }),
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
