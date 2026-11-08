import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RiArrowLeftLine, RiExternalLinkLine, RiRefreshLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Meter } from "@/components/base/meter/meter";
import { Card } from "@/components/wono/card";
import { CopyField } from "@/components/wono/copy-field";
import { Details, Mono } from "@/components/wono/details";
import { Notice } from "@/components/wono/notice";
import { PageHeader } from "@/components/wono/page-header";
import { ContributionStatus, InvoiceStatus } from "@/components/wono/status";
import { TokenLogo } from "@/components/wono/token-logo";
import { currentMerchant } from "@/lib/server/auth.ts";
import { eventsFor, invoiceForMerchant, invoiceView } from "@/lib/server/invoices.ts";
import { publicOrigin } from "@/lib/server/origin.ts";
import { formatAmount, formatDate, formatUsdc, shortAddress } from "@/lib/shared/format";
import { refreshInvoice } from "../../actions";

export const metadata: Metadata = { title: "Payment" };

const eventLabel = (type: string) => type.replace(/[._]/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

export default async function PaymentPage(props: PageProps<"/dashboard/invoices/[invoiceId]">) {
  const { invoiceId } = await props.params;
  const merchant = (await currentMerchant())!;
  const row = await invoiceForMerchant(merchant.id, invoiceId);
  if (!row) notFound();
  const invoice = await invoiceView(row, merchant.storeName, { includeUnsent: true });
  const events = await eventsFor(invoiceId, 30);
  const origin = await publicOrigin();
  const checkoutUrl = `${origin}/pay/${invoice.id}`;
  const sent = invoice.contributions.filter((part) => part.txHash || part.state !== "cancelled");
  const proofFor = (txHash: string | null) => invoice.settlements.find((settlement) => settlement.signature === txHash);

  return (
    <>
      <ButtonLink href="/dashboard/payments" size="small" variant="ghost" leadingIcon={RiArrowLeftLine} className="w-fit">Payments</ButtonLink>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{formatUsdc(invoice.amount)} USDC <InvoiceStatus state={invoice.state} /></span>}
        description={[invoice.description, invoice.reference].filter(Boolean).join(" · ") || invoice.id}
        actions={
          <>
            <form action={refreshInvoice.bind(null, invoice.id)}>
              <Button type="submit" variant="secondary" leadingIcon={RiRefreshLine}>Refresh</Button>
            </form>
            <ButtonLink href={checkoutUrl} target="_blank" rel="noreferrer" variant="secondary" trailingIcon={RiExternalLinkLine}>Checkout</ButtonLink>
          </>
        }
      />

      {invoice.state === "partial" ? (
        <Notice tone="warning" title="Partly paid">{formatUsdc(invoice.credited)} of {formatUsdc(invoice.amount)} USDC is in your wallet. Wait for the rest before fulfilling.</Notice>
      ) : null}
      {invoice.state === "unknown" ? <Notice tone="error" title="Needs review">A transfer&apos;s outcome is unclear. Its amount stays reserved so the customer isn&apos;t charged twice.</Notice> : null}

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-headline-semibold text-text-primary">Received</span>
              <span className="text-body-medium tabular-nums text-text-secondary">
                <span className="text-text-primary">{formatUsdc(invoice.credited)}</span> / {formatUsdc(invoice.amount)} USDC
              </span>
            </div>
            <Meter aria-label="USDC received" value={Number(invoice.credited)} maxValue={Math.max(1, Number(invoice.amount))} tone={invoice.state === "paid" ? "success" : "accent"} />
            {sent.length === 0 ? (
              <p className="text-body-regular text-text-tertiary">No payment yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-separator-border">
                {sent.map((part) => {
                  const proof = proofFor(part.txHash) ?? (part.provider?.destinationTxHashes?.length ? invoice.settlements.find((settlement) => part.provider!.destinationTxHashes!.includes(settlement.signature)) : undefined);
                  return (
                    <li key={part.id} className="flex items-center gap-3 py-4 first:pt-2 last:pb-0">
                      <TokenLogo symbol={part.symbol} blockchain={part.chain} chainName={part.chainName} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 text-body-medium text-text-primary">
                          {formatUsdc(part.amountOut)} USDC
                          <Chip variant="caption" color="soft">{part.depositAddress ? "Aurora" : "Direct"}</Chip>
                        </span>
                        <span className="truncate text-caption-1-regular text-text-tertiary">
                          {part.amountIn ? `${formatAmount(part.amountIn, part.decimals, 8)} ${part.symbol}` : part.symbol} on {part.chainName} · from {shortAddress(part.sourceAddress)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {proof ? <ButtonLink href={proof.url} target="_blank" rel="noreferrer" size="small" variant="secondary" trailingIcon={RiExternalLinkLine}>Proof</ButtonLink> : part.txUrl ? <ButtonLink href={part.txUrl} target="_blank" rel="noreferrer" size="small" variant="secondary" trailingIcon={RiExternalLinkLine}>Sent</ButtonLink> : null}
                        <ContributionStatus state={part.state} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {invoice.settlements.length ? (
            <Card title="On-chain proof">
              <ul className="flex flex-col divide-y divide-separator-border">
                {invoice.settlements.map((settlement) => (
                  <li key={settlement.signature} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-body-medium tabular-nums text-text-primary">{formatUsdc(settlement.amount)} USDC</span>
                      <Mono>{shortAddress(settlement.signature, 8)}</Mono>
                    </span>
                    <ButtonLink href={settlement.url} target="_blank" rel="noreferrer" size="small" variant="secondary" trailingIcon={RiExternalLinkLine}>Solscan</ButtonLink>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Details">
            <Details
              rows={[
                { label: "Pays to", value: <Mono>{shortAddress(invoice.recipient, 6)}</Mono> },
                { label: "Created", value: formatDate(invoice.createdAt) },
                { label: "Expires", value: invoice.expiresAt ? formatDate(invoice.expiresAt) : "Never" },
                { label: "Checked", value: formatDate(invoice.checkedAt) },
              ]}
            />
          </Card>
          <Card title="Payment link">
            <CopyField label="Share this link" value={checkoutUrl} />
          </Card>
          <Card title="Activity">
            {events.length === 0 ? (
              <p className="text-body-regular text-text-tertiary">Nothing yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {events.map((event, index) => (
                  <li key={index} className="flex justify-between gap-3 text-body-2-regular">
                    <span className="truncate text-text-primary">{eventLabel(event.type)}</span>
                    <span className="shrink-0 text-text-tertiary">{formatDate(event.created_at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
