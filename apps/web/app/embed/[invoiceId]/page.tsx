import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Checkout } from "@/components/checkout/checkout";
import { Notice } from "@/components/wono/notice";
import { merchantById } from "@/lib/server/auth.ts";
import { invoiceRow, invoiceView } from "@/lib/server/invoices.ts";

export const metadata: Metadata = { title: "Pay", robots: { index: false } };

/**
 * Embedded checkout. `parent` must be one of the merchant's embed origins (keyless wallet
 * links allow "*": no account exists to hold a list, and the payee is fixed by the link). The proxy
 * sets `frame-ancestors` to exactly that origin, so the browser enforces it too, and
 * postMessage only ever targets it.
 */
export default async function EmbedPage(props: PageProps<"/embed/[invoiceId]">) {
  const { invoiceId } = await props.params;
  const parentParam = (await props.searchParams).parent;
  const invoice = await invoiceRow(invoiceId);
  if (!invoice) notFound();
  const merchant = await merchantById(invoice.merchant_id);
  let parent: string | null = null;
  try {
    parent = typeof parentParam === "string" ? new URL(parentParam).origin : null;
  } catch {
    parent = null;
  }
  if (!merchant || !parent || !(merchant.allowedOrigins.includes(parent) || merchant.allowedOrigins.includes("*"))) {
    return (
      <div className="mx-auto flex max-w-checkout flex-col gap-4 p-4">
        <Notice tone="error" title="This site is not authorized to embed checkout">
          The merchant must add this site&apos;s origin to their Wono embed origins.
        </Notice>
        <a className="text-body-medium text-accent-600 underline-offset-4 hover:underline" href={`/pay/${invoiceId}`} target="_blank" rel="noreferrer">Open checkout in a new tab</a>
      </div>
    );
  }
  return <Checkout initial={await invoiceView(invoice, merchant.storeName)} parentOrigin={parent} />;
}
