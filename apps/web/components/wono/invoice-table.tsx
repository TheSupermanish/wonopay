"use client";

import type { InvoiceState } from "@wono/sdk";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { formatDate, formatUsdc } from "@/lib/shared/format";
import { InvoiceStatus } from "./status";
import { TokenLogo } from "./token-logo";

export interface InvoiceListItem {
  id: string;
  description: string | null;
  reference: string | null;
  amount: string;
  credited: string;
  state: InvoiceState;
  createdAt: string;
  /** Tokens the customer paid with, by chain. */
  sources: { chain: string; chainName: string; symbol: string }[];
}

export function InvoiceTable({ invoices }: { invoices: InvoiceListItem[] }) {
  return (
    <Table aria-label="Payments">
      <TableHeader>
        <TableColumn isRowHeader>Payment</TableColumn>
        <TableColumn>Paid with</TableColumn>
        <TableColumn>Status</TableColumn>
        <TableColumn>Amount</TableColumn>
        <TableColumn>Created</TableColumn>
      </TableHeader>
      <TableBody items={invoices}>
        {(invoice) => (
          <TableRow id={invoice.id} href={`/dashboard/invoices/${invoice.id}`} className="cursor-pointer hover:bg-background-secondary-hover">
            <TableCell>
              <span className="flex max-w-xs flex-col">
                <span className="truncate text-body-medium text-text-primary" title={invoice.description ?? undefined}>{invoice.description || invoice.reference || "Payment"}</span>
                <span className="font-mono text-caption-1-regular text-text-tertiary">{invoice.reference ?? invoice.id}</span>
              </span>
            </TableCell>
            <TableCell>
              {invoice.sources.length ? (
                <span className="flex -space-x-1.5" title={invoice.sources.map((source) => `${source.symbol} · ${source.chainName}`).join(", ")}>
                  {invoice.sources.map((source) => (
                    <TokenLogo key={`${source.chain}:${source.symbol}`} symbol={source.symbol} blockchain={source.chain} chainName={source.chainName} small className="rounded-full ring-2 ring-background-primary-default" />
                  ))}
                </span>
              ) : (
                <span className="text-text-tertiary">—</span>
              )}
            </TableCell>
            <TableCell><InvoiceStatus state={invoice.state} /></TableCell>
            <TableCell>
              <span className="flex flex-col tabular-nums">
                <span className="text-body-medium text-text-primary">{formatUsdc(invoice.amount)} USDC</span>
                {invoice.credited !== "0" && invoice.credited !== invoice.amount ? <span className="text-caption-1-regular text-text-tertiary">{formatUsdc(invoice.credited)} received</span> : null}
              </span>
            </TableCell>
            <TableCell>{formatDate(invoice.createdAt)}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
