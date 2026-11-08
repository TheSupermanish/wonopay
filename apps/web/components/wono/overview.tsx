"use client";

import { RiCheckboxCircleFill, RiCoinsFill, RiFileAddFill, RiRouteLine, RiTimeFill } from "@remixicon/react";
import { RevenueChartCard } from "@/components/application/dashboard/revenue-chart-card";
import { StatCards, type Stat } from "@/components/application/dashboard/stat-cards";
import { Meter } from "@/components/base/meter/meter";
import { TokenLogo } from "@/components/wono/token-logo";
import type { MerchantAnalytics } from "@/lib/server/analytics.ts";

function change(current: number, previous: number): Pick<Stat, "delta" | "deltaColor"> {
  if (previous === 0) return current === 0 ? { delta: "0%", deltaColor: "neutral" } : { delta: "New", deltaColor: "lime" };
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  return { delta: `${percent > 0 ? "+" : ""}${percent}%`, deltaColor: percent > 0 ? "lime" : percent < 0 ? "rose" : "neutral" };
}

const usdc = (value: string) => Number(value.replace(/,/g, ""));

export function Overview({ data }: { data: MerchantAnalytics }) {
  const period = `vs prior ${data.days}d`;
  const stats: Stat[] = [
    {
      icon: RiCoinsFill,
      label: "Settled USDC",
      value: `$${data.settled.current}`,
      ...change(usdc(data.settled.current), usdc(data.settled.previous)),
      tone: "emerald",
      caption: period,
      hint: "USDC that Wono saw land in your Solana wallet, verified on-chain, in the last " + data.days + " days.",
    },
    {
      icon: RiCheckboxCircleFill,
      label: "Paid invoices",
      value: data.paid.current.toLocaleString("en-US"),
      ...change(data.paid.current, data.paid.previous),
      tone: "blue",
      caption: period,
      hint: "Invoices fully paid and verified in the window.",
    },
    {
      icon: RiFileAddFill,
      label: "Invoices created",
      value: data.created.current.toLocaleString("en-US"),
      ...change(data.created.current, data.created.previous),
      tone: "purple",
      caption: period,
      hint: "Invoices created from the dashboard or the API in the window.",
    },
    {
      icon: RiTimeFill,
      label: "Outstanding",
      value: `$${data.outstanding.amount}`,
      delta: `${data.outstanding.invoices} open`,
      deltaColor: "neutral",
      tone: "orange",
      caption: "To collect",
      hint: "USDC not yet received across invoices that can still be paid.",
    },
  ];
  const quiet = data.daily.every((point) => point.current === 0 && point.previous === 0);
  const maxRoutes = Math.max(1, ...data.sources.map((source) => source.routes));
  return (
    <>
      <StatCards variant="footer" stats={stats} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="relative min-w-0 xl:col-span-2">
          <RevenueChartCard
          data={data.daily}
          title={`Settled, last ${data.days} days`}
          legend={[`Last ${data.days} days`, `${data.days} days before`]}
          comparison={{ total: `the ${data.days} days before`, point: `${data.days} days earlier` }}
          fractionDigits={2}
          />
          {quiet ? (
            <p className="pointer-events-none absolute inset-x-4 top-1/2 mx-auto w-fit text-center rounded-full bg-background-primary-default px-3 py-1.5 text-caption-1-medium text-text-secondary shadow-xs">
              No verified settlements yet. They appear here once USDC lands in your wallet.
            </p>
          ) : null}
        </div>
        <section className="flex min-w-0 flex-col gap-4 rounded-2xl bg-background-secondary-default p-4">
          <header className="flex flex-col gap-0.5">
            <p className="text-body-medium text-text-secondary">Paid with</p>
            <p className="text-body-2-medium text-text-tertiary">Tokens customers routed through Aurora</p>
          </header>
          {data.sources.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <RiRouteLine className="size-6 text-foreground-icon-tertiary" aria-hidden />
              <p className="text-body-regular text-text-secondary">No routes yet</p>
              <p className="text-caption-1-medium text-text-tertiary">Each token a customer picks at checkout shows up here.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {data.sources.map((source) => (
                <li key={`${source.chain}:${source.symbol}`} className="flex items-center gap-3">
                  <TokenLogo symbol={source.symbol} blockchain={source.chain} chainName={source.chainName} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body-medium text-text-primary">
                        {source.symbol} <span className="text-text-tertiary">{source.chainName}</span>
                      </span>
                      <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{source.routes}</span>
                    </div>
                    <Meter aria-label={`${source.symbol} on ${source.chainName}`} value={source.routes} maxValue={maxRoutes} size="sm" tone={source.settled > 0 ? "success" : "accent"} />
                    <span className="text-caption-1-medium text-text-tertiary tabular-nums">
                      {source.routes === 1 ? "1 route" : `${source.routes} routes`} · {source.settled} settled
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
