import type { Metadata } from "next";
import { RiExchangeDollarLine, RiLinkM } from "@remixicon/react";
import { ButtonLink } from "@/components/base/buttons/button";
import { Card } from "@/components/wono/card";
import { EmptyState } from "@/components/wono/empty-state";
import { InvoiceTable } from "@/components/wono/invoice-table";
import { PageHeader } from "@/components/wono/page-header";
import { paymentRows } from "@/lib/server/analytics.ts";
import { currentMerchant } from "@/lib/server/auth.ts";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const merchant = (await currentMerchant())!;
  const rows = await paymentRows(merchant.id);
  const link = merchant.settlementAddress ? <ButtonLink href="/dashboard/invoices/new" variant="secondary" leadingIcon={RiLinkM}>New payment link</ButtonLink> : null;
  return (
    <>
      <PageHeader title="Payments" description="Every checkout, with the tokens it was paid in." actions={link} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={RiExchangeDollarLine} title="No payments yet">Payments created by the SDK or a payment link appear here.</EmptyState>
        ) : (
          <InvoiceTable invoices={rows} />
        )}
      </Card>
    </>
  );
}
