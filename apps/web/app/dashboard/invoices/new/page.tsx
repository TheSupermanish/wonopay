import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/wono/card";
import { PageHeader } from "@/components/wono/page-header";
import { currentMerchant } from "@/lib/server/auth.ts";
import { NewInvoiceForm } from "./form";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const merchant = (await currentMerchant())!;
  if (!merchant.settlementAddress) redirect("/dashboard/settings");
  return (
    <>
      <PageHeader title="New invoice" description="Creates a payment link. Customers can combine tokens from several chains." />
      <Card className="max-w-form">
        <NewInvoiceForm recipient={merchant.settlementAddress} />
      </Card>
    </>
  );
}
