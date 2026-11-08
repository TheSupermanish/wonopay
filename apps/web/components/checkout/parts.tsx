"use client";

import { useState, type ReactNode } from "react";
import { Heading } from "react-aria-components";
import { motion, useReducedMotion } from "motion/react";
import {
  RiAlertLine,
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiWallet3Line,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { InputBase, TextField } from "@/components/base/input/input";
import { useModalClose } from "@/components/base/modal/modal";
import { Spinner } from "@/components/base/spinner/spinner";
import { TokenLogo } from "@/components/wono/token-logo";
import { cx } from "@/utils/cx";

/** Presentational pieces of the pay modal. State and payment logic live in checkout.tsx. */

const tile = "rounded-2xl bg-background-secondary-default";
/** Merchant monogram, tinted with the accent so the checkout carries the brand colour. */
export function MerchantAvatar({ name, logo, large, xl }: { name: string; logo?: string | null; large?: boolean; xl?: boolean }) {
  const size = xl ? "size-16" : large ? "size-10" : "size-6";
  if (logo) return <img src={logo} alt="" className={cx(size, "shrink-0 rounded-full bg-background-secondary-default object-cover")} />;
  return (
    <span aria-hidden className={cx("flex shrink-0 items-center justify-center rounded-full bg-button-ghost-background text-button-ghost-foreground", size, xl ? "text-title-2-medium" : large ? "text-headline-semibold" : "text-caption-1-semibold")}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const SETTLEMENT = { symbol: "USDC", blockchain: "sol", chainName: "Solana" };

const pressable = "outline-none transition-colors hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring";

/** Wallet-modal header: back on the start side, centered title, close on the end side. */
export function PayHeader({ title, onBack, closable }: { title: ReactNode; onBack?: () => void; closable: boolean }) {
  const close = useModalClose();
  return (
    <div className="grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 px-6">
      {onBack ? <IconButton icon={RiArrowLeftLine} size="small" aria-label="Back" className="border-0 bg-transparent shadow-none" onClick={onBack} /> : <span className="size-8" />}
      <Heading slot="title" className="truncate text-center text-headline-semibold text-text-primary">{title}</Heading>
      {closable ? <CloseButton size="md" aria-label="Close" onClick={close} /> : <span className="size-8" />}
    </div>
  );
}

/** Column header inside the two-column pay view: title on the start side, close on the end. */
export function PaneHeader({ title, trailing, closable }: { title: ReactNode; trailing?: ReactNode; closable: boolean }) {
  const close = useModalClose();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Heading slot="title" className="flex-1 truncate text-headline-semibold text-text-primary">{title}</Heading>
      {trailing}
      {closable ? <CloseButton size="md" aria-label="Close" onClick={close} /> : null}
    </div>
  );
}

/** One pill per chain the customer holds tokens on, plus All. */
export function ChainFilter({ chains, value, onChange }: { chains: { id: string; name: string }[]; value: string | null; onChange: (id: string | null) => void }) {
  const pill = (active: boolean) =>
    cx(
      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-caption-1-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
      active ? "border-accent-500 bg-accent-500 text-text-white" : "border-border-button-default text-text-secondary hover:bg-background-secondary-default",
    );
  return (
    <div className="-mx-6 flex shrink-0 gap-1.5 overflow-x-auto px-6 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Filter by chain">
      <button type="button" aria-pressed={value === null} className={pill(value === null)} onClick={() => onChange(null)}>All</button>
      {chains.map((chain) => (
        <button key={chain.id} type="button" aria-pressed={value === chain.id} className={cx(pill(value === chain.id), "ps-1.5")} onClick={() => onChange(value === chain.id ? null : chain.id)}>
          <img src={`/icons/chains/${chain.id}.svg`} alt="" className="size-5 rounded-full bg-background-primary-default" />
          {chain.name}
        </button>
      ))}
    </div>
  );
}

/** The amount being paid, centered, with who receives it. */
export function AmountHero({ merchant, logo, amount }: { merchant: string; logo?: string | null; amount: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-background-secondary-default p-3">
      <MerchantAvatar name={merchant} logo={logo} />
      <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">{merchant}</span>
      <span className="text-title-3-semibold tabular-nums text-text-primary">
        {amount} <span className="text-body-medium text-text-tertiary">USDC</span>
      </span>
    </div>
  );
}

export function WalletIcon({ src, className }: { src: string; className?: string }) {
  return src ? <img src={src} alt="" className={cx("size-10 rounded-xl bg-background-primary-default", className)} /> : <RiWallet3Line className={cx("size-10 text-foreground-icon-secondary", className)} aria-hidden />;
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-background-tertiary-default px-1.5 py-0.5 text-caption-1-medium text-text-secondary">{children}</span>;
}

/** One wallet app (e.g. Phantom) with the chains it can connect. */
export function WalletRow({ name, icon, chains, connected, busy, disabled, onPress }: {
  name: string;
  icon: string;
  chains: string[];
  connected: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" disabled={disabled || connected} onClick={onPress} className={cx("flex w-full items-center gap-3 p-3 text-start disabled:cursor-default", tile, !connected && pressable)}>
      <WalletIcon src={icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-body-medium text-text-primary">{name}</span>
        <span className="flex gap-1">{chains.map((chain) => <Tag key={chain}>{chain}</Tag>)}</span>
      </span>
      {busy ? (
        <Spinner size="sm" aria-label="Connecting" />
      ) : connected ? (
        <span className="flex items-center gap-1 text-caption-1-medium text-status-lime-text"><RiCheckLine className="size-4" aria-hidden />Connected</span>
      ) : (
        <span className="flex items-center gap-1 text-caption-1-medium text-text-tertiary">Installed<RiArrowRightSLine className="size-4" aria-hidden /></span>
      )}
    </button>
  );
}

/** A wallet app that can reopen this checkout in its own browser (phones, or no extension). */
export function WalletAppLink({ name, icon, chains, href }: { name: string; icon: string; chains: string[]; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx("flex w-full items-center gap-3 p-3 text-start", tile, pressable)}>
      <WalletIcon src={icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-body-medium text-text-primary">{name}</span>
        <span className="flex gap-1">{chains.map((chain) => <Tag key={chain}>{chain}</Tag>)}</span>
      </span>
      <span className="flex items-center gap-1 text-caption-1-medium text-accent-600">Open app<RiExternalLinkLine className="size-4" aria-hidden /></span>
    </a>
  );
}

export interface TokenInfo {
  symbol: string;
  blockchain: string;
  chainName: string;
}

/** "12.34" -> 1234 cents; undefined while the text is not a valid amount. */
function parseCents(text: string): number | undefined {
  const value = text.trim();
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * One token from the connected wallets. Every token with a balance is listed; pressing the row
 * adds it to the payment or takes it out. A selected row shows how much of the invoice it covers
 * (typed in USDC) and what the wallet will send for that.
 */
export function TokenRow({ token, balanceText, valueText, selected, disabled, disabledReason, cents, maxCents, spend, pricing, problem, onToggle, onChange }: {
  token: TokenInfo;
  balanceText: string;
  valueText?: string;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  cents: number;
  maxCents: number;
  spend?: string;
  pricing: boolean;
  problem?: string;
  onToggle: () => void;
  onChange: (cents: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const max = Math.max(1, maxCents);
  return (
    <li className={cx("flex flex-col rounded-2xl border transition-colors", selected ? "border-accent-500 bg-background-primary-default" : "border-separator-border hover:bg-background-secondary-default")}>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onToggle}
        className={cx("flex w-full items-center gap-3 rounded-2xl p-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring disabled:opacity-50", selected && "rounded-b-none", false)}
      >
        <TokenLogo symbol={token.symbol} blockchain={token.blockchain} chainName={token.chainName} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-medium text-text-primary">{token.symbol} <span className="text-text-tertiary">{token.chainName}</span></span>
          <span className="truncate text-caption-1-regular tabular-nums text-text-tertiary">{disabled && disabledReason ? disabledReason : balanceText}</span>
        </span>
        {valueText ? <span className="text-body-medium tabular-nums text-text-secondary">{valueText}</span> : null}
        <span aria-hidden className={cx("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent-500 bg-accent-500 text-text-white" : "border-border-button-default")}>
          {selected ? <RiCheckLine className="size-3.5" /> : null}
        </span>
      </button>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <TextField
            aria-label={`USDC paid with ${token.symbol} on ${token.chainName}`}
            size="small"
            className="w-32 shrink-0"
            inputClassName="tabular-nums"
            value={draft ?? (cents / 100).toFixed(2)}
            onChange={(text) => {
              setDraft(text);
              const parsed = parseCents(text);
              if (parsed !== undefined) onChange(Math.min(parsed, max));
            }}
            onBlur={() => setDraft(null)}
          >
            <InputBase inputMode="decimal" trailingAddon={<span className="pe-2 text-caption-1-medium text-text-tertiary">USDC</span>} />
          </TextField>
          <Button size="small" variant="secondary" disabled={cents >= max} onClick={() => { setDraft(null); onChange(max); }}>Max</Button>
          <span className="flex min-w-0 basis-full items-center gap-1 truncate text-caption-1-regular tabular-nums text-text-tertiary sm:flex-1 sm:basis-auto sm:justify-end">
            {problem ? <span className="truncate text-text-error-primary">{problem}</span> : (
              <>
                {pricing ? <Spinner size="xs" aria-hidden /> : null}
                <span className="truncate">{spend ?? "Pricing…"}</span>
              </>
            )}
          </span>
        </div>
      ) : null}
    </li>
  );
}

/** "This token becomes USDC on Solana": source logo, a moving route, the settlement logo. */
export function RouteHop({ token }: { token: TokenInfo }) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      <TokenLogo symbol={token.symbol} blockchain={token.blockchain} chainName={token.chainName} />
      <span className="relative flex w-8 items-center overflow-hidden">
        <span className="h-px w-full bg-separator-border" />
        <motion.span
          className="absolute size-1.5 rounded-full bg-accent-500"
          initial={{ x: -4 }}
          animate={{ x: 32 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
      <TokenLogo {...SETTLEMENT} />
    </span>
  );
}

/** Paid: a check that lands with a little spring. */
const CONFETTI_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-accent-500"];
/** 42 pieces on fixed angles and distances, so every render bursts the same way. */
const CONFETTI = Array.from({ length: 42 }, (_, index) => {
  const angle = (index / 42) * Math.PI * 2 + (index % 3) * 0.21;
  const distance = 70 + ((index * 37) % 90);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 30,
    rotate: ((index * 53) % 360) - 180,
    delay: (index % 7) * 0.02,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length]!,
    round: index % 4 === 0,
  };
});

function Confetti() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {CONFETTI.map((piece, index) => (
        <motion.span
          key={index}
          className={cx("absolute start-1/2 top-1/2", piece.color, piece.round ? "size-2 rounded-full" : "h-2.5 w-1.5 rounded-xs")}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: piece.x, y: [0, piece.y, piece.y + 120], opacity: [1, 1, 0], rotate: piece.rotate * 3, scale: 1 }}
          transition={{ duration: 1.6, delay: 0.15 + piece.delay, ease: [0.22, 1, 0.36, 1], times: [0, 0.45, 1] }}
        />
      ))}
    </span>
  );
}

export function PaidMark({ title, detail }: { title: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <span className="relative flex size-16 items-center justify-center">
        <Confetti />
        <motion.span
          className="absolute inset-0 rounded-full bg-status-lime-background"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: [0.6, 1.25, 1], opacity: [0, 0.6, 1] }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
        <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 320, damping: 14, delay: 0.15 }} className="relative text-status-lime-text">
          <RiCheckLine className="size-8" aria-hidden />
        </motion.span>
      </span>
      <span className="text-title-3-semibold text-text-primary">{title}</span>
      <span className="text-caption-1-regular text-text-tertiary">{detail}</span>
    </div>
  );
}

/** Label/value line for summaries. */
export function Line({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-body-regular text-text-secondary">{label}</span>
      <span className={cx("text-end tabular-nums", strong ? "text-body-semibold text-text-primary" : "text-body-medium text-text-primary")}>{value}</span>
    </div>
  );
}

export type StepState = "pending" | "active" | "done" | "failed" | "warning";

/** One row of the payment progress list. */
export function Step({ state, title, detail, children }: { state: StepState; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <li className={cx("flex gap-3 p-3 transition-shadow", tile, state === "active" && "ring-2 ring-accent-500/30", state === "warning" && children && "ring-1 ring-status-orange-text/30")}>
      <span
        className={cx(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-status-lime-background text-status-lime-text",
          state === "failed" && "bg-notification-error-background text-notification-error-foreground",
          state === "warning" && "bg-status-orange-background text-status-orange-text",
          (state === "pending" || state === "active") && "bg-background-tertiary-default text-foreground-icon-tertiary",
        )}
      >
        {state === "active" ? <Spinner size="xs" aria-label="In progress" /> : null}
        {state === "done" ? (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }} className="flex">
            <RiCheckLine className="size-4" aria-hidden />
          </motion.span>
        ) : null}
        {state === "failed" ? <RiCloseLine className="size-4" aria-hidden /> : null}
        {state === "warning" ? <RiAlertLine className="size-4" aria-hidden /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cx("text-body-medium", state === "pending" && !children ? "text-text-tertiary" : "text-text-primary")}>{title}</span>
        {detail ? <span className="text-caption-1-regular text-text-tertiary">{detail}</span> : null}
        {children}
      </span>
    </li>
  );
}
