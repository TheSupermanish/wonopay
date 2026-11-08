import type { Metadata } from "next";
import { RiAddLine, RiArrowRightLine, RiExchangeDollarLine } from "@remixicon/react";
import { ButtonLink } from "@/components/base/buttons/button";
import { Card } from "@/components/wono/card";
import { EmptyState } from "@/components/wono/empty-state";
import { InvoiceTable } from "@/components/wono/invoice-table";
import { Notice } from "@/components/wono/notice";
import { Overview } from "@/components/wono/overview";
import { PageHeader } from "@/components/wono/page-header";
import { merchantAnalytics, paymentRows } from "@/lib/server/analytics.ts";
import { currentMerchant } from "@/lib/server/auth.ts";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const merchant = (await currentMerchant())!;
  const analytics = await merchantAnalytics(merchant.id);
  const recent = await paymentRows(merchant.id, 6);
  return (
    <>
      <PageHeader title={merchant.storeName} description="USDC on Solana, from any token your customers hold." />
      {!merchant.settlementAddress ? (
        <Notice tone="warning" title="Add a payout wallet">
          <span>Payments need a Solana wallet to receive USDC. <a className="underline underline-offset-4" href="/dashboard/settings">Open settings</a></span>
        </Notice>
      ) : null}
      <Overview data={analytics} />
      <Card title="Recent payments" actions={recent.length ? <ButtonLink href="/dashboard/payments" size="small" variant="secondary" trailingIcon={RiArrowRightLine}>All payments</ButtonLink> : null}>
        {recent.length === 0 ? (
          <EmptyState
            icon={RiExchangeDollarLine}
            title="No payments yet"
            action={<ButtonLink href="/dashboard/developers" variant="secondary" leadingIcon={RiAddLine}>Set up the SDK</ButtonLink>}
          >
            Payments from your store appear here as customers check out.
          </EmptyState>
        ) : (
          <InvoiceTable invoices={recent} />
        )}
      </Card>
    </>
  );
}
