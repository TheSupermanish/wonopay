import type { ContributionState, InvoiceState } from "@wono/sdk";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { CONTRIBUTION_STATE, INVOICE_STATE } from "@/lib/shared/format";

export function InvoiceStatus({ state }: { state: InvoiceState }) {
  const entry = INVOICE_STATE[state];
  return <Chip variant="caption" color={entry.tone as ChipColor} title={entry.help}>{entry.label}</Chip>;
}

export function ContributionStatus({ state }: { state: ContributionState }) {
  const entry = CONTRIBUTION_STATE[state];
  return <Chip variant="caption" color={entry.tone as ChipColor}>{entry.label}</Chip>;
}
