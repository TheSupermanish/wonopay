import type { Metadata } from "next";
import { Notice } from "@/components/wono/notice";
import { PageHeader } from "@/components/wono/page-header";
import { currentMerchant } from "@/lib/server/auth.ts";
import { checkSettlementAddress } from "@/lib/server/invoices.ts";
import { SettingsView } from "./form";
import { PaymasterCard, type PaymasterView } from "@/components/wono/paymaster-card";
import { sponsoredTransfers } from "@/lib/server/analytics.ts";
import { sponsorStatus } from "@/lib/server/solana-tx.ts";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/dashboard/settings">) {
  const merchant = (await currentMerchant())!;
  const welcome = (await props.searchParams).welcome === "1";
  const sponsor = await sponsorStatus();
  const sol = (lamports: bigint) => (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const paymaster: PaymasterView = sponsor.configured
    ? { configured: true, publicKey: sponsor.publicKey, balance: sponsor.lamports === null ? null : sol(sponsor.lamports), minimum: sol(sponsor.minLamports), funded: sponsor.funded, sponsored: await sponsoredTransfers(merchant.id, sponsor.publicKey) }
    : { configured: false };
  const usdc = merchant.settlementAddress ? await checkSettlementAddress(merchant.settlementAddress).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Settings" description={merchant.email} />
      {welcome && !merchant.settlementAddress ? <Notice title="Welcome to Wono">Add the Solana wallet that should receive USDC, then create your first invoice.</Notice> : null}
      {usdc?.usdcAccountExists === false ? (
        <Notice tone="warning" title="No USDC account yet">
          This wallet has no USDC token account. Aurora&apos;s Solana withdrawal is expected to create it, but Wono has not verified that path; receiving any USDC first removes the doubt.
        </Notice>
      ) : null}
      <SettingsView
        storeName={merchant.storeName}
        settlementAddress={merchant.settlementAddress ?? ""}
        origins={merchant.allowedOrigins.join(" ")}
        usdcReady={usdc?.usdcAccountExists ?? null}
        apiKeyHint={merchant.apiKeyHint}
        logo={merchant.logo}
        paymaster={paymaster}
      />
    </>
  );
}
