import { RiGasStationLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Card } from "@/components/wono/card";
import { CopyField } from "@/components/wono/copy-field";
import { Details } from "@/components/wono/details";

export type PaymasterView =
  | { configured: false }
  | { configured: true; publicKey: string; balance: string | null; minimum: string; funded: boolean; sponsored: number };

/** Solana paymaster: Wono's fee wallet that pays network fees and account rent for customers. */
export function PaymasterCard({ paymaster }: { paymaster: PaymasterView }) {
  const status = !paymaster.configured
    ? { color: "soft" as const, label: "Off" }
    : paymaster.funded
      ? { color: "lime" as const, label: "Active" }
      : { color: "yellow" as const, label: "Needs SOL" };
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Chip color="cyan" className="size-8 rounded-lg px-0" aria-hidden>
          <RiGasStationLine className="size-4" />
        </Chip>
        <h2 className="min-w-0 flex-1 text-headline-semibold text-text-primary">Paymaster</h2>
        <Chip variant="caption" color={status.color}>{status.label}</Chip>
      </div>
      {paymaster.configured ? (
        <>
          <Details
            rows={[
              { label: "Pays", value: "Solana network fees and account rent" },
              { label: "Balance", value: paymaster.balance === null ? "Unavailable" : `${paymaster.balance} SOL` },
              { label: "Active from", value: `${paymaster.minimum} SOL` },
              { label: "Transfers sponsored", value: paymaster.sponsored.toLocaleString("en-US") },
            ]}
          />
          <CopyField label="Top up this address with SOL" value={paymaster.publicKey} />
        </>
      ) : (
        <p className="text-body-regular text-text-secondary">Set WONO_SOLANA_FEE_PAYER_SECRET on the server to pay customers&apos; Solana fees.</p>
      )}
    </Card>
  );
}
