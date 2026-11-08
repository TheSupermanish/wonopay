import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Checkout } from "@/components/checkout/checkout";
import { merchantById } from "@/lib/server/auth.ts";
import { invoiceRow, invoiceView } from "@/lib/server/invoices.ts";

export const metadata: Metadata = { title: "Pay", robots: { index: false } };

export default async function PayPage(props: PageProps<"/pay/[invoiceId]">) {
  const { invoiceId } = await props.params;
  const invoice = await invoiceRow(invoiceId);
  if (!invoice) notFound();
  const merchant = await merchantById(invoice.merchant_id);
  return <Checkout initial={await invoiceView(invoice, merchant?.storeName ?? "Merchant")} parentOrigin={null} />;
}
