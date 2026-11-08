import type { ContributionState, InvoiceState } from "@wono/sdk";

const USDC_DECIMALS = 6;

/** Format base units with grouping. Integer arithmetic only; truncates, never rounds up. */
export function formatAmount(units: string, decimals: number, maxFraction = decimals): string {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (absolute / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % scale).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatUsdc(units: string): string {
  const [whole, fraction = ""] = formatAmount(units, USDC_DECIMALS).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

export function shortAddress(value: string, size = 4): string {
  return value.length <= size * 2 + 3 ? value : `${value.slice(0, size + (value.startsWith("0x") ? 2 : 0))}…${value.slice(-size)}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export type Tone = "neutral" | "blue" | "lime" | "yellow" | "rose" | "orange" | "purple" | "cyan";

export const INVOICE_STATE: Record<InvoiceState, { label: string; tone: Tone; help: string }> = {
  open: { label: "Open", tone: "neutral", help: "No payment has started." },
  quoted: { label: "Quoted", tone: "neutral", help: "Routes are reserved; the customer has not approved a transfer." },
  awaiting_approval: { label: "Awaiting approval", tone: "yellow", help: "A transfer is waiting for the customer's wallet approval." },
  submitted: { label: "Submitted", tone: "blue", help: "A transfer was signed or broadcast; Aurora has not seen it yet." },
  processing: { label: "Processing", tone: "blue", help: "Aurora is routing at least one contribution." },
  partial: { label: "Partially paid", tone: "orange", help: "Some USDC is verified in your wallet; the full amount is not." },
  paid: { label: "Paid", tone: "lime", help: "The full amount is verified on Solana with finality." },
  refunded: { label: "Refunded", tone: "purple", help: "Contributions were returned to the customer by Aurora." },
  failed: { label: "Failed", tone: "rose", help: "Contributions failed; no USDC was credited." },
  unknown: { label: "Needs review", tone: "rose", help: "An outcome could not be established. Nothing will be resent automatically." },
};

export const CONTRIBUTION_STATE: Record<ContributionState, { label: string; tone: Tone }> = {
  quoted: { label: "Ready to approve", tone: "neutral" },
  awaiting_approval: { label: "Awaiting wallet", tone: "yellow" },
  submitted: { label: "Submitted", tone: "blue" },
  processing: { label: "Processing", tone: "blue" },
  settled: { label: "Verifying on Solana", tone: "cyan" },
  verified: { label: "Verified", tone: "lime" },
  refunded: { label: "Refunded", tone: "purple" },
  failed: { label: "Failed", tone: "rose" },
  unknown: { label: "Unknown", tone: "rose" },
  cancelled: { label: "Not sent", tone: "neutral" },
  expired: { label: "Expired · not sent", tone: "neutral" },
};
