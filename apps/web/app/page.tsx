import type { ReactNode } from "react";
import {
  RiArrowRightLine,
  RiLockLine,
  RiShieldCheckLine,
  RiStackLine,
  RiWallet3Line,
} from "@remixicon/react";
import { SOURCE_CHAINS } from "@wono/sdk";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { ButtonLink } from "@/components/base/buttons/button";
import { Logo } from "@/components/wono/logo";
import { TokenLogo } from "@/components/wono/token-logo";
import { currentMerchant } from "@/lib/server/auth.ts";

/** Public landing page. Describes what Wono does today; no invented numbers. */

const STEPS: { title: string; body: string }[] = [
  { title: "Create an invoice", body: "Set the amount in USDC." },
  { title: "Share the link", body: "Your customer pays from any wallet, with any token." },
  { title: "Get USDC", body: "It lands in your Solana wallet." },
];

const FEATURES: { icon: typeof RiLockLine; title: string; body: string }[] = [
  { icon: RiStackLine, title: "Any token, any chain", body: `SOL, ETH, USDT and more across ${SOURCE_CHAINS.length} chains. Customers can even split one payment.` },
  { icon: RiWallet3Line, title: "Straight to your wallet", body: "No custody. Funds go from their wallet to yours." },
  { icon: RiShieldCheckLine, title: "Paid means paid", body: "Every payment is confirmed on Solana before it counts." },
];

const SETTLEMENT = { symbol: "USDC", blockchain: "sol", chainName: "Solana" };

export default async function Home() {
  const signedIn = Boolean(await currentMerchant());
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-content items-center justify-between gap-3 px-4 py-4 lg:px-8">
        <Logo />
        <nav className="flex items-center gap-2" aria-label="Account">
          <ThemeToggle collapsed size="small" />
          {signedIn ? (
            <ButtonLink href="/dashboard" size="small">Open dashboard</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" size="small" variant="secondary">Sign in</ButtonLink>
              <ButtonLink href="/signup" size="small">Get started</ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-content flex-col gap-20 px-4 pb-20 pt-12 lg:px-8 lg:pt-20">
        <section className="flex flex-col items-center gap-6 text-center">
          <span className="flex items-center gap-2 rounded-full border border-border-button-default bg-background-primary-default px-3 py-1 text-caption-1-medium text-text-secondary">
            <TokenLogo {...SETTLEMENT} />
            Settles native USDC on Solana
          </span>
          <h1 className="max-w-3xl text-display-4-semibold text-balance sm:text-display-2-semibold text-text-primary">
            Get paid in USDC. Customers pay with anything.
          </h1>
          <p className="max-w-2xl text-title-3-medium text-balance text-text-secondary">
            Customers pay from any wallet on {SOURCE_CHAINS.length} chains. You receive USDC on Solana.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ButtonLink href={signedIn ? "/dashboard/invoices/new" : "/signup"} trailingIcon={RiArrowRightLine}>
              {signedIn ? "Create an invoice" : "Start accepting payments"}
            </ButtonLink>
            <ButtonLink href="#how" variant="secondary">How it works</ButtonLink>
          </div>
          <RouteDiagram />
        </section>

        <section id="how" className="flex scroll-mt-8 flex-col gap-8">
          <SectionTitle eyebrow="How it works" title="Three steps" />
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3 rounded-3xl border border-border-button-default bg-background-primary-default p-5">
                <span className="flex size-8 items-center justify-center rounded-full bg-accent-500 text-caption-1-semibold text-text-white">{index + 1}</span>
                <h3 className="text-headline-semibold text-text-primary">{step.title}</h3>
                <p className="text-body-regular text-text-secondary">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-8">
          <SectionTitle eyebrow="Why Wono" title="Built for merchants" />
          <ul className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex flex-col gap-2 rounded-3xl bg-background-secondary-default p-5">
                <Icon className="size-6 text-foreground-icon-secondary" aria-hidden />
                <h3 className="text-headline-semibold text-text-primary">{title}</h3>
                <p className="text-body-regular text-text-secondary">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col items-center gap-6 rounded-3xl border border-border-button-default bg-background-primary-default px-6 py-12 text-center">
          <h2 className="text-title-1-semibold text-text-primary">Ready for your first invoice?</h2>
          <p className="max-w-xl text-body-regular text-text-secondary">Add your Solana wallet and share a payment link in a minute.</p>
          <ButtonLink href={signedIn ? "/dashboard/invoices/new" : "/signup"} trailingIcon={RiArrowRightLine}>
            {signedIn ? "Create an invoice" : "Create a free account"}
          </ButtonLink>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-2 border-t border-separator-border px-4 py-6 text-caption-1-regular text-text-tertiary lg:px-8">
        <span>Wono</span>
        <span>Powered by Aurora Intents and Solana</span>
      </footer>
    </div>
  );
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-caption-1-semibold uppercase text-accent-500">{eyebrow}</span>
      <h2 className="text-title-1-semibold text-balance text-text-primary">{title}</h2>
      {description ? <p className="max-w-2xl text-body-regular text-balance text-text-secondary">{description}</p> : null}
    </div>
  );
}

/** Source chains on the start side flowing into Solana USDC. Illustration of the routing, not data. */
function RouteDiagram(): ReactNode {
  return (
    <div className="mt-6 flex w-full max-w-3xl flex-col items-center gap-6 rounded-3xl border border-border-button-default bg-background-primary-default p-6 sm:flex-row sm:justify-between">
      <ul className="grid grid-cols-4 gap-3" aria-label="Customers pay from">
        {SOURCE_CHAINS.map((chain) => (
          <li key={chain.blockchain} className="flex flex-col items-center gap-1">
            <TokenLogo symbol={chain.nativeSymbol} blockchain={chain.blockchain} chainName={chain.name} />
            <span className="text-caption-1-regular text-text-tertiary">{chain.name}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-center gap-1 text-caption-1-medium text-text-tertiary">
        <RiArrowRightLine className="size-6 rotate-90 text-foreground-icon-tertiary sm:rotate-0" aria-hidden />
        Aurora Intents
      </div>
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-background-secondary-default px-6 py-4">
        <TokenLogo {...SETTLEMENT} />
        <span className="text-headline-semibold text-text-primary">USDC on Solana</span>
        <span className="text-caption-1-regular text-text-tertiary">Your wallet</span>
      </div>
    </div>
  );
}
