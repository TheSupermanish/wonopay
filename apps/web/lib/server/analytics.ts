import { SOURCE_CHAINS } from "@wono/sdk";
import { col } from "./db.ts";

/**
 * Dashboard analytics for one merchant, computed from Wono's own records only:
 * verified settlements (money that reached the wallet), invoices, and the routes
 * customers chose. Sums stay in bigint base units; numbers appear only for display.
 */

const DAY = 86_400_000;
const USDC_DECIMALS = 6;

export type DailyPoint = { label: string; current: number; previous: number };
export type SourceShare = { chain: string; chainName: string; symbol: string; routes: number; settled: number };
export type MerchantAnalytics = {
  /** USDC verified on-chain in the last `days` days, and the window before it. */
  settled: { current: string; previous: string };
  paid: { current: number; previous: number };
  created: { current: number; previous: number };
  outstanding: { amount: string; invoices: number };
  /** One point per day for the last `days` days; `previous` is the same weekday one window earlier. */
  daily: DailyPoint[];
  /** Tokens customers routed through Aurora (every attempt), most used first. */
  sources: SourceShare[];
  days: number;
};

const toUnits = (value: string | null | undefined) => {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
};
const toUsdc = (units: bigint) => Number(units) / 10 ** USDC_DECIMALS;
const formatUnits = (units: bigint) => {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
};

const OPEN_STATES = new Set(["open", "quoted", "awaiting_approval", "submitted", "processing", "partial", "unknown"]);

async function invoiceIdsForMerchant(merchantId: string): Promise<string[]> {
  const invoices = await col("invoices");
  const rows = (await invoices.find({ merchant_id: merchantId }, { projection: { id: 1, _id: 0 } }).toArray()) as unknown as { id: string }[];
  return rows.map((row) => row.id);
}

export async function merchantAnalytics(merchantId: string, days = 14, now = Date.now()): Promise<MerchantAnalytics> {
  const start = now - days * DAY;
  const previousStart = start - days * DAY;
  const invoiceIds = await invoiceIdsForMerchant(merchantId);

  const settlementsCol = await col("settlements");
  const settlements = (invoiceIds.length
    ? await settlementsCol
        .find({ invoice_id: { $in: invoiceIds } }, { projection: { amount: 1, verified_at: 1, block_time: 1, _id: 0 } })
        .toArray()
    : []) as unknown as { amount: string; verified_at: string; block_time: number | null }[];

  const daily: { current: bigint; previous: bigint }[] = Array.from({ length: days }, () => ({ current: 0n, previous: 0n }));
  let settledCurrent = 0n;
  let settledPrevious = 0n;
  const dayStart = (time: number) => Math.floor(time / DAY) * DAY;
  const today = dayStart(now);
  for (const row of settlements) {
    const at = row.block_time ? row.block_time * 1000 : Date.parse(row.verified_at);
    const amount = toUnits(row.amount);
    const ago = Math.floor((today - dayStart(at)) / DAY);
    if (ago >= 0 && ago < days) {
      daily[days - 1 - ago]!.current += amount;
      settledCurrent += amount;
    } else if (ago >= days && ago < days * 2) {
      daily[days * 2 - 1 - ago]!.previous += amount;
      settledPrevious += amount;
    }
  }

  const invoicesCol = await col("invoices");
  const invoices = (await invoicesCol
    .find({ merchant_id: merchantId }, { projection: { state: 1, amount: 1, credited: 1, created_at: 1, updated_at: 1, _id: 0 } })
    .toArray()) as unknown as { state: string; amount: string; credited: string; created_at: string; updated_at: string }[];
  const inWindow = (iso: string, from: number, to: number) => {
    const time = Date.parse(iso);
    return time >= from && time < to;
  };
  let outstanding = 0n;
  let openCount = 0;
  const counts = { paid: [0, 0], created: [0, 0] };
  for (const invoice of invoices) {
    if (inWindow(invoice.created_at, start, now + 1)) counts.created[0] += 1;
    else if (inWindow(invoice.created_at, previousStart, start)) counts.created[1] += 1;
    if (invoice.state === "paid") {
      if (inWindow(invoice.updated_at, start, now + 1)) counts.paid[0] += 1;
      else if (inWindow(invoice.updated_at, previousStart, start)) counts.paid[1] += 1;
    }
    if (OPEN_STATES.has(invoice.state)) {
      const left = toUnits(invoice.amount) - toUnits(invoice.credited);
      if (left > 0n) {
        outstanding += left;
        openCount += 1;
      }
    }
  }

  const contributionsCol = await col("contributions");
  const sourceContributions = (invoiceIds.length
    ? await contributionsCol
        .find({ invoice_id: { $in: invoiceIds } }, { projection: { chain: 1, origin_symbol: 1, state: 1, _id: 0 } })
        .toArray()
    : []) as unknown as { chain: string; origin_symbol: string; state: string }[];
  const sourceGroups = new Map<string, { chain: string; symbol: string; routes: number; settled: number }>();
  for (const row of sourceContributions) {
    const key = `${row.chain}\u0000${row.origin_symbol}`;
    const group = sourceGroups.get(key) ?? { chain: row.chain, symbol: row.origin_symbol, routes: 0, settled: 0 };
    group.routes += 1;
    if (row.state === "settled" || row.state === "verified") group.settled += 1;
    sourceGroups.set(key, group);
  }
  const sourceRows = [...sourceGroups.values()].sort((a, b) => b.routes - a.routes).slice(0, 6);
  const chainName = (id: string) => SOURCE_CHAINS.find((chain) => chain.blockchain === id)?.name ?? id;

  return {
    days,
    settled: { current: formatUnits(settledCurrent), previous: formatUnits(settledPrevious) },
    paid: { current: counts.paid[0]!, previous: counts.paid[1]! },
    created: { current: counts.created[0]!, previous: counts.created[1]! },
    outstanding: { amount: formatUnits(outstanding), invoices: openCount },
    daily: daily.map((point, index) => {
      const date = new Date(today - (days - 1 - index) * DAY);
      return {
        label: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        current: toUsdc(point.current),
        previous: toUsdc(point.previous),
      };
    }),
    sources: sourceRows.map((row) => ({ chain: row.chain, chainName: chainName(row.chain), symbol: row.symbol, routes: row.routes, settled: row.settled })),
  };
}

/** Solana transfers for this merchant whose network fee and rent the given sponsor paid. */
export async function sponsoredTransfers(merchantId: string, sponsor: string): Promise<number> {
  const invoiceIds = await invoiceIdsForMerchant(merchantId);
  if (!invoiceIds.length) return 0;
  const contributions = await col("contributions");
  return contributions.countDocuments({ invoice_id: { $in: invoiceIds }, fee_payer: sponsor, tx_hash: { $ne: null } });
}

/** Tokens each invoice was actually paid or attempted with (routes that reached a wallet). */
export async function paidWith(merchantId: string): Promise<Map<string, { chain: string; symbol: string }[]>> {
  const invoiceIds = await invoiceIdsForMerchant(merchantId);
  const map = new Map<string, { chain: string; symbol: string }[]>();
  if (!invoiceIds.length) return map;
  const contributions = await col("contributions");
  const rows = (await contributions
    .find(
      { invoice_id: { $in: invoiceIds }, state: { $nin: ["quoted", "cancelled", "expired"] } },
      { projection: { invoice_id: 1, chain: 1, origin_symbol: 1, position: 1, _id: 0 } },
    )
    .toArray()) as unknown as { invoice_id: string; chain: string; origin_symbol: string; position: number }[];
  // Reproduce GROUP BY invoice_id, chain, origin_symbol ORDER BY MIN(position): dedupe keeping min position, then order groups per invoice by that position.
  const groups = new Map<string, { invoice_id: string; chain: string; symbol: string; minPosition: number }>();
  for (const row of rows) {
    const key = `${row.invoice_id}\u0000${row.chain}\u0000${row.origin_symbol}`;
    const existing = groups.get(key);
    if (existing) existing.minPosition = Math.min(existing.minPosition, row.position);
    else groups.set(key, { invoice_id: row.invoice_id, chain: row.chain, symbol: row.origin_symbol, minPosition: row.position });
  }
  const byInvoice = new Map<string, { chain: string; symbol: string; minPosition: number }[]>();
  for (const group of groups.values()) {
    byInvoice.set(group.invoice_id, [...(byInvoice.get(group.invoice_id) ?? []), group]);
  }
  for (const [invoiceId, list] of byInvoice) {
    map.set(
      invoiceId,
      list.sort((a, b) => a.minPosition - b.minPosition).map((entry) => ({ chain: entry.chain, symbol: entry.symbol })),
    );
  }
  return map;
}

/** Rows for the payments table: each invoice with the tokens it was paid with. */
export async function paymentRows(merchantId: string, limit = 200) {
  const sources = await paidWith(merchantId);
  const chainName = (id: string) => SOURCE_CHAINS.find((chain) => chain.blockchain === id)?.name ?? id;
  const invoices = await col("invoices");
  const rows = (await invoices
    .find({ merchant_id: merchantId }, { projection: { id: 1, description: 1, reference: 1, amount: 1, credited: 1, state: 1, created_at: 1, _id: 0 } })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray()) as unknown as { id: string; description: string | null; reference: string | null; amount: string; credited: string; state: string; created_at: string }[];
  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    reference: row.reference,
    amount: row.amount,
    credited: row.credited,
    state: row.state as import("@wono/sdk").InvoiceState,
    createdAt: row.created_at,
    sources: (sources.get(row.id) ?? []).map((source) => ({ ...source, chainName: chainName(source.chain) })),
  }));
}
