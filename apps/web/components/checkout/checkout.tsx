"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiExternalLinkLine,
  RiLockLine,
  RiRefreshLine,
  RiSearchLine,
  RiTimeLine,
  RiWallet3Line,
} from "@remixicon/react";
import { SOURCE_CHAINS, type ContributionState } from "@wono/sdk";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Modal, ModalBody, ModalFooter } from "@/components/base/modal/modal";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { Spinner } from "@/components/base/spinner/spinner";
import { addShare } from "@/lib/shared/allocation";
import { AmountHero, ChainFilter, Line, MerchantAvatar, PaidMark, PaneHeader, PayHeader, RouteHop, Step, TokenRow, WalletAppLink, WalletIcon, WalletRow, type StepState } from "@/components/checkout/parts";
import { MotionConfig, motion } from "motion/react";
import { isPublicUrl, walletAppLinks } from "@/lib/shared/wallet-links";
import { Card } from "@/components/wono/card";
import { Details, Mono } from "@/components/wono/details";
import { Logo } from "@/components/wono/logo";
import { Notice } from "@/components/wono/notice";
import { cx } from "@/utils/cx";
import { ContributionStatus, InvoiceStatus } from "@/components/wono/status";
import { TokenLogo } from "@/components/wono/token-logo";
import {
  api,
  ApiError,
  local,
  newAttemptKey,
  type BalanceResult,
  type CatalogToken,
  type DryQuoteResult,
  type InvoiceView,
  type WalletOutcome,
} from "@/lib/client/api";
import {
  connectEvm,
  connectSolana,
  discoverEvmWallets,
  discoverSolanaWallets,
  errorMessage,
  isUserRejection,
  solanaSignAndSend,
  solanaSignTransaction,
  switchEvmChain,
  type EvmWallet,
  type SolanaWallet,
} from "@/lib/client/wallets";
import { formatAmount, formatDate, formatUsdc, shortAddress } from "@/lib/shared/format";

const ACTIVE: ReadonlySet<ContributionState> = new Set(["awaiting_approval", "submitted", "processing", "settled", "unknown"]);
/** One cent of USDC in base units (6 decimals). Shares move in whole cents. */
const CENT = 10_000n;
/** A reserved route may cost at most this much more (per mille) than the estimate before Wono asks the wallet. */
const DRIFT_PERMILLE = 20;
/** Aurora's flat fee per route into Solana (live: 0.237 USDC), plus ~0.5% spread. Display hint only. */
/** Auto-pick avoids Aurora shares smaller than this (cents): the route fee would be a large part of them. */
const MIN_ROUTE_CENTS = 200;
/** Balances worth less than this (display estimate, USD) are folded away: route costs would exceed them. */
const DUST_USD = 0.5;
/** One colour per token share in the coverage bar, in selection order. */
const SHARE_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

interface Connected<W> {
  wallet: W;
  address: string;
}

interface StoredAttempt {
  key: string;
  attemptId: string;
}

type QuoteState = { cents: number; result: DryQuoteResult | "loading" };

/** Wallet approvals for routes: all Solana parts in one transaction, each EVM part on its own. */
function batchesFor(parts: InvoiceView["contributions"]): InvoiceView["contributions"][] {
  const solana = parts.filter((part) => part.chain === "sol");
  return [...(solana.length ? [solana] : []), ...parts.filter((part) => part.chain !== "sol").map((part) => [part])];
}

/** Display-only USD value of a balance from the catalog price. */
function usdValue(amount: string, token: CatalogToken): number | undefined {
  if (!token.price) return undefined;
  const micros = (BigInt(amount) * BigInt(Math.round(token.price * 1e6))) / 10n ** BigInt(token.decimals);
  return Number(micros) / 1e6;
}

type AllocRow = { token: CatalogToken; amount?: string; usd?: number };

/**
 * The cheapest mix that covers `remainingCents`. Aurora charges a flat fee (~$0.24) for every
 * route into Solana, so the fewest routes win: Solana USDC first (paid directly, no route),
 * then the largest balances, Ethereum mainnet last (gas).
 */
function autoAllocate(rows: AllocRow[], remainingCents: number, caps: Record<string, number>): Record<string, number> {
  const tier = (token: CatalogToken) => (isSettlementAsset(token) ? 0 : token.blockchain === "eth" ? 2 : 1);
  const usable = rows
    .filter((row) => row.amount !== undefined && row.amount !== "0" && caps[row.token.assetId] !== 0 && (row.usd === undefined || row.usd >= DUST_USD))
    .map((row) => ({ row, max: Math.min(sliderMax(row.token, row.usd, remainingCents, row.amount), caps[row.token.assetId] ?? Infinity) }))
    .sort((a, b) => tier(a.row.token) - tier(b.row.token) || b.max - a.max || Number(b.row.token.kind === "solana") - Number(a.row.token.kind === "solana"));
  const next: Record<string, number> = {};
  let left = remainingCents;
  // An Aurora route costs a roughly fixed fee, so tiny shares are skipped where possible.
  for (const minimum of [MIN_ROUTE_CENTS, 1]) {
    for (const entry of usable) {
      if (left <= 0) break;
      if (entry.row.usd === undefined) continue;
      const have = next[entry.row.token.assetId] ?? 0;
      const take = Math.min(left, entry.max - have);
      if (take <= 0) continue;
      if (!isSettlementAsset(entry.row.token) && have + take < minimum) continue;
      next[entry.row.token.assetId] = have + take;
      left -= take;
    }
  }
  return next;
}

/** "$1,234.56", or "$938.4M" for large values. Display only. */
function usdText(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
}

/** Token amount with at most 4 significant decimals, compact when large. Display only. */
function amountText(amount: string, decimals: number): string {
  const value = Number(amount) / 10 ** decimals;
  return new Intl.NumberFormat("en-US", { notation: value >= 100_000 ? "compact" : "standard", maximumSignificantDigits: value >= 1 ? undefined : 4, maximumFractionDigits: value >= 1 ? 4 : undefined }).format(value);
}

/** Route fee in USD from provider estimates (display only). */
/** Small fees keep a third decimal so routes can be told apart. */
function usdFee(value: number): string {
  return `$${value < 0.1 ? value.toFixed(3) : value.toFixed(2)}`;
}

function feeUsd(quote: { amountInUsd?: string; amountOutUsd?: string; direct?: boolean }): number | undefined {
  if (quote.direct) return 0;
  const paid = Number(quote.amountInUsd);
  const delivered = Number(quote.amountOutUsd);
  if (!Number.isFinite(paid) || !Number.isFinite(delivered)) return undefined;
  return Math.max(0, paid - delivered);
}

/** Native USDC on Solana: the asset invoices settle in, sent directly (the server decides by asset id). */
function isSettlementAsset(token: CatalogToken): boolean {
  return token.blockchain === "sol" && token.symbol === "USDC" && token.decimals === 6;
}

/** Slider range in cents: up to the balance's estimated value (native tokens keep 5% for fees), never past what is owed. */
function sliderMax(token: CatalogToken, usd: number | undefined, remainingCents: number, amount?: string): number {
  // Solana USDC is paid to the merchant 1:1 with no route fee: the whole balance counts.
  if (isSettlementAsset(token) && amount !== undefined) return Math.max(1, Math.min(remainingCents, Number(BigInt(amount) / CENT)));
  if (usd === undefined) return remainingCents;
  const cents = Math.floor(usd * 100 * (token.contractAddress ? 1 : 0.95));
  return Math.max(1, Math.min(remainingCents, cents));
}

export function Checkout({ initial, parentOrigin }: { initial: InvoiceView; parentOrigin: string | null }) {
  const [invoice, setInvoice] = useState(initial);
  const [tokens, setTokens] = useState<CatalogToken[] | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [evmWallets, setEvmWallets] = useState<EvmWallet[]>([]);
  const [solWallets, setSolWallets] = useState<SolanaWallet[]>([]);
  const [evm, setEvm] = useState<Connected<EvmWallet> | null>(null);
  const [sol, setSol] = useState<Connected<SolanaWallet> | null>(null);
  const [balances, setBalances] = useState<Record<string, BalanceResult | "loading">>({});
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({});
  const [step, setStep] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"wallet" | "tokens" | "review" | "progress">("wallet");
  const [auto, setAuto] = useState(true);
  // Per-token share ceiling (cents) learned from a live quote: the most the balance covers after route costs.
  const [caps, setCaps] = useState<Record<string, number>>({});
  const quoteRequest = useRef(0);
  const [attempt, setAttempt] = useState<StoredAttempt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const storageKey = `wono:attempt:${invoice.id}`;

  // ---- embed messaging (display hints only; never proof of payment) ----
  const post = useCallback(
    (message: Record<string, unknown>) => {
      if (!parentOrigin || window.parent === window) return;
      window.parent.postMessage({ ...message, invoiceId: invoice.id }, parentOrigin);
    },
    [parentOrigin, invoice.id],
  );
  // Embedded, checkout is only the pay modal: the merchant's page opens this frame full-window over
  // itself, the modal opens at once, and closing it asks the page to remove the frame.
  const embedded = parentOrigin !== null;
  const autoOpened = useRef(false);
  useEffect(() => {
    if (embedded) post({ type: "wono:ready" });
  }, [embedded, post]);
  useEffect(() => {
    if (!embedded) return;
    if (open) {
      autoOpened.current = true;
      return;
    }
    if (!autoOpened.current) return;
    // Let the modal's exit transition (300ms) finish before the page removes the frame.
    const timer = window.setTimeout(() => post({ type: "wono:close" }), 320);
    return () => window.clearTimeout(timer);
  }, [embedded, open, post]);
  useEffect(() => post({ type: "wono:status", state: invoice.state }), [invoice.state, post]);

  // ---- discovery, catalog, stored attempt ----
  useEffect(() => {
    const stopEvm = discoverEvmWallets(setEvmWallets);
    const stopSol = discoverSolanaWallets(setSolWallets);
    api.tokens().then((data) => setTokens(data.tokens), (failure: Error) => setTokensError(failure.message));
    const stored = local.get(storageKey);
    if (stored) {
      try {
        setAttempt(JSON.parse(stored) as StoredAttempt);
      } catch {
        local.remove(storageKey);
      }
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      stopEvm();
      stopSol();
      window.clearInterval(timer);
    };
  }, [storageKey]);

  const refresh = useCallback(async () => {
    try {
      setInvoice(await api.refresh(invoice.id));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status !== 0) setError(failure.message);
    }
  }, [invoice.id]);

  // Resubmit wallet outcomes that were recorded locally but not acknowledged by the server.
  useEffect(() => {
    if (!attempt) return;
    const pending = local.get(`wono:outcome:${attempt.attemptId}`);
    if (!pending) return;
    const { ids, outcome } = JSON.parse(pending) as { ids: string[]; outcome: WalletOutcome };
    api.outcome(ids, attempt.key, outcome).then(
      () => local.remove(`wono:outcome:${attempt.attemptId}`),
      (failure: ApiError) => failure.status >= 400 && failure.status < 500 && local.remove(`wono:outcome:${attempt.attemptId}`),
    ).finally(refresh);
  }, [attempt, refresh]);

  const inFlight = invoice.contributions.some((part) => ACTIVE.has(part.state));
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), inFlight ? 8_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [inFlight, refresh]);

  // ---- balances ----
  const loadBalances = useCallback(
    async (kind: "solana" | "evm", address: string) => {
      if (!tokens) return;
      const chains = [...new Set(tokens.filter((token) => token.kind === kind).map((token) => token.blockchain))];
      setBalances((current) => {
        const next = { ...current };
        for (const token of tokens) if (token.kind === kind) next[token.assetId] = "loading";
        return next;
      });
      await Promise.all(
        chains.map(async (blockchain) => {
          try {
            const { balances: results } = await api.balances(blockchain, address);
            setBalances((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.assetId, result])) }));
          } catch (failure) {
            const message = failure instanceof Error ? failure.message : "Balance unavailable.";
            setBalances((current) => {
              const next = { ...current };
              for (const token of tokens) if (token.blockchain === blockchain) next[token.assetId] = { assetId: token.assetId, status: "error", message };
              return next;
            });
          }
        }),
      );
    },
    [tokens],
  );
  useEffect(() => {
    if (evm) void loadBalances("evm", evm.address);
  }, [evm, loadBalances]);
  useEffect(() => {
    if (sol) void loadBalances("solana", sol.address);
  }, [sol, loadBalances]);

  // One button per wallet app. Phantom and similar announce a Solana (Wallet Standard)
  // and an EVM (EIP-6963) provider; connecting the app connects both, each with its own prompt.
  const walletApps = useMemo(() => groupWallets(solWallets, evmWallets), [solWallets, evmWallets]);

  async function connect(app: WalletApp): Promise<boolean> {
    setError(null);
    setBusy(`connect:${app.key}`);
    const problems: string[] = [];
    let connected = false;
    try {
      if (app.sol && !sol) {
        try {
          setSol({ wallet: app.sol, address: await connectSolana(app.sol) });
          connected = true;
        } catch (failure) {
          problems.push(`Solana: ${isUserRejection(failure) ? "declined" : errorMessage(failure)}`);
        }
      }
      if (app.evm && !evm) {
        try {
          setEvm({ wallet: app.evm, address: await connectEvm(app.evm) });
          connected = true;
        } catch (failure) {
          problems.push(`EVM: ${isUserRejection(failure) ? "declined" : errorMessage(failure)}`);
        }
      }
      if (problems.length) setError(`${app.name} did not connect everything. ${problems.join(" · ")}`);
    } finally {
      setBusy(null);
    }
    return connected || Boolean(sol || evm);
  }

  // ---- allocation ----
  // Shares are whole cents of USDC, set with one slider per token. Base units are integers.
  const payable = !invoice.expired && invoice.state !== "paid" && BigInt(invoice.remaining) > 0n;
  const remainingCents = Number(BigInt(invoice.remaining) / CENT);
  const selected = Object.entries(selection).filter(([, cents]) => cents > 0);
  const allocatedCents = selected.reduce((sum, [, cents]) => sum + cents, 0);
  const allocated = BigInt(allocatedCents) * CENT;
  const allocationValid = selected.length > 0 && allocated === BigInt(invoice.remaining);

  function addressFor(token: CatalogToken): string | undefined {
    return token.kind === "solana" ? sol?.address : evm?.address;
  }

  function setShare(assetId: string, cents: number) {
    setSelection((current) => {
      const others = Object.entries(current).reduce((sum, [id, value]) => (id === assetId ? sum : sum + value), 0);
      const next = { ...current, [assetId]: Math.max(0, Math.min(cents, remainingCents - others)) };
      if (next[assetId] === 0) delete next[assetId];
      return next;
    });
  }

  const parts = useCallback(
    (shares: [string, number][]) =>
      shares.map(([assetId, cents]) => {
        const token = tokens!.find((entry) => entry.assetId === assetId)!;
        return { assetId, amountOut: (BigInt(cents) * CENT).toString(), sourceAddress: (token.kind === "solana" ? sol?.address : evm?.address)! };
      }),
    [tokens, sol, evm],
  );

  // Indicative quotes follow the sliders (debounced). They reserve nothing.
  const selectionKey = JSON.stringify(selected.sort(([a], [b]) => a.localeCompare(b)));
  useEffect(() => {
    const shares = JSON.parse(selectionKey) as [string, number][];
    if (shares.length === 0 || !tokens) {
      setQuotes({});
      return;
    }
    const wanted = Object.fromEntries(shares.map(([assetId, cents]) => [assetId, cents]));
    setQuotes((current) => Object.fromEntries(shares.map(([assetId, cents]) => [assetId, current[assetId]?.cents === cents ? current[assetId]! : { cents, result: "loading" as const }])));
    const timer = window.setTimeout(async () => {
      const request = ++quoteRequest.current;
      try {
        const { quotes: results } = await api.quote(invoice.id, parts(shares));
        if (request !== quoteRequest.current) return;
        setQuotes(Object.fromEntries(results.map((result) => [result.assetId, { cents: wanted[result.assetId]!, result }])));
      } catch (failure) {
        if (request !== quoteRequest.current) return;
        const message = failure instanceof Error ? failure.message : "Quote unavailable.";
        setQuotes(Object.fromEntries(shares.map(([assetId, cents]) => [assetId, { cents, result: { assetId, ok: false as const, error: message } }])));
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      quoteRequest.current += 1; // a response for an older allocation must not land on this one
    };
  }, [selectionKey, tokens, invoice.id, parts]);

  // When a live quote needs more than the balance, shrink that share to what the balance covers
  // after route costs (costs are not proportional, so the next quote may trim once more).
  useEffect(() => {
    for (const [assetId, entry] of Object.entries(quotes)) {
      const result = entry.result;
      const balance = balances[assetId];
      if (result === "loading" || !result.ok || !balance || balance === "loading" || balance.status !== "ok") continue;
      const need = BigInt(result.quote.amountIn);
      const have = BigInt(balance.amount);
      if (need <= have) continue;
      const fit = Math.max(0, Number((BigInt(entry.cents) * have) / need) - 1);
      setCaps((current) => ({ ...current, [assetId]: fit }));
      setShare(assetId, fit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setShare only touches state setters
  }, [quotes, balances]);

  // ---- wallet approval ----
  async function report(at: StoredAttempt, ids: string[], outcome: WalletOutcome) {
    // Persist locally first so a lost response cannot lose a transaction id.
    const storeKey = `wono:outcome:${at.attemptId}`;
    local.set(storeKey, JSON.stringify({ ids, outcome }));
    for (let tries = 0; tries < 4; tries += 1) {
      try {
        await api.outcome(ids, at.key, outcome);
        local.remove(storeKey);
        return;
      } catch (failure) {
        if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
          local.remove(storeKey);
          throw failure;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500 * (tries + 1)));
      }
    }
    throw new Error("Could not reach Wono to record the wallet result. Keep this page open; it will retry.");
  }

  /**
   * One wallet approval: every Solana part from one wallet together, or one EVM part.
   * Returns true when the wallet signed or sent; false when declined or failed (nothing more is requested).
   */
  async function approve(batch: InvoiceView["contributions"], at: StoredAttempt | null = attempt): Promise<boolean> {
    if (!at || batch.length === 0) return false;
    const ids = batch.map((part) => part.id);
    const first = batch[0]!;
    setError(null);
    setBusy(`approve:${first.id}`);
    try {
      if (first.chain === "sol") {
        if (!sol || sol.address !== first.sourceAddress) throw new Error(`Connect the Solana wallet ${shortAddress(first.sourceAddress)} first.`);
        const method = sol.wallet.canSignTransaction ? "signTransaction" : "signAndSendTransaction";
        const request = await api.approval(ids, at.key, sol.address, method);
        if (request.kind !== "solana") throw new Error("Unexpected wallet request.");
        if (method === "signTransaction") {
          let signed: string;
          try {
            signed = await solanaSignTransaction(sol.wallet, sol.address, request.transaction);
          } catch (failure) {
            // signTransaction never broadcasts, so any failure here means nothing was sent.
            await report(at, ids, { type: "declined", reason: isUserRejection(failure) ? "Declined in wallet." : errorMessage(failure) });
            return false;
          }
          await report(at, ids, { type: "solana_signed", signedTransaction: signed });
          return true;
        }
        try {
          await report(at, ids, { type: "sent", txHash: await solanaSignAndSend(sol.wallet, sol.address, request.transaction) });
          return true;
        } catch (failure) {
          await report(at, ids, isUserRejection(failure) ? { type: "declined" } : { type: "uncertain", reason: errorMessage(failure) });
          return false;
        }
      }
      if (!evm || evm.address !== first.sourceAddress.toLowerCase()) throw new Error(`Connect the EVM wallet ${shortAddress(first.sourceAddress)} first.`);
      const token = tokens?.find((entry) => entry.blockchain === first.chain && entry.chainId);
      if (!token?.chainId) throw new Error("Unknown network.");
      // Switching networks happens before the server marks the route as awaiting approval.
      await switchEvmChain(evm.wallet, token.chainId);
      const request = await api.approval(ids, at.key, evm.address, "eth_sendTransaction");
      if (request.kind !== "evm" || request.chainId !== token.chainId) throw new Error("Unexpected wallet request.");
      let hash: unknown;
      try {
        hash = await evm.wallet.provider.request({ method: "eth_sendTransaction", params: [request.transaction] });
      } catch (failure) {
        await report(at, ids, isUserRejection(failure) ? { type: "declined" } : { type: "uncertain", reason: errorMessage(failure) });
        return false;
      }
      await report(at, ids, typeof hash === "string" ? { type: "sent", txHash: hash } : { type: "uncertain", reason: "Wallet returned no transaction hash." });
      return typeof hash === "string";
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : errorMessage(failure));
      return false;
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  /**
   * The one Pay button: reserve a fresh route per share (persisted server-side before it is
   * shown), then ask each wallet in turn. Stops at the first decline or failure; routes not
   * yet approved stay listed with their own Approve button until the window closes.
   */
  async function pay() {
    setError(null);
    setBusy("prepare");
    const key = newAttemptKey();
    let at: StoredAttempt;
    let reserved: InvoiceView["contributions"];
    try {
      // Store the key first: retries reuse it and the server returns the same attempt.
      local.set(storageKey, JSON.stringify({ key, attemptId: "" }));
      const result = await api.attempt(invoice.id, key, parts(selected));
      setInvoice(result.invoice);
      if (result.status !== "ready") {
        local.remove(storageKey);
        setError(result.error ?? "Routes could not be prepared. No funds were moved.");
        return;
      }
      at = { key, attemptId: result.attemptId };
      local.set(storageKey, JSON.stringify(at));
      setAttempt(at);
      reserved = result.invoice.contributions.filter((part) => part.attemptId === at.attemptId && part.state === "quoted");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Routes could not be prepared.");
      return;
    } finally {
      setBusy(null);
    }
    setSelection({});

    // Reserved amounts can differ from the indicative quote. Ask the wallet only when the
    // route still fits the balance and has not moved by more than the tolerance.
    for (const part of reserved) {
      const balance = balances[part.assetId];
      const shown = quotes[part.assetId]?.result;
      if (!part.amountIn) continue;
      if (balance && balance !== "loading" && balance.status === "ok" && BigInt(part.amountIn) > BigInt(balance.amount)) {
        setError(`The reserved route needs ${formatAmount(part.amountIn, part.decimals, 8)} ${part.symbol}, more than your balance. Nothing was sent.`);
        return;
      }
      if (shown && shown !== "loading" && shown.ok && BigInt(part.amountIn) * 1000n > BigInt(shown.quote.amountIn) * BigInt(1000 + DRIFT_PERMILLE)) {
        setError(`The price of ${part.symbol} moved since the estimate. Check the amounts below and approve if they look right.`);
        return;
      }
    }

    const batches = batchesFor(reserved);
    for (const [index, batch] of batches.entries()) {
      setStep(batches.length > 1 ? `${index + 1} of ${batches.length}` : null);
      const ok = await approve(batch, at);
      if (!ok) break;
    }
    setStep(null);
  }

  // ---- view ----
  const visibleParts = invoice.contributions;
  /** Several shares sent in one wallet transaction: link it once, not per share. */
  const sentHashes = [...new Set(visibleParts.map((part) => part.txHash).filter(Boolean))];
  const sharedTx = sentHashes.length === 1 && visibleParts.filter((part) => part.txHash).length > 1;
  /** Paid view: each share that reached the merchant, with the settlement that proves it. */
  const paidShares = visibleParts
    .filter((part) => part.state === "verified" || part.state === "settled")
    .map((part) => ({
      part,
      proof: invoice.settlements.find((settlement) => settlement.signature === part.txHash || part.provider?.destinationTxHashes?.includes(settlement.signature)),
    }));
  const pendingApproval = visibleParts.filter((part) => part.state === "quoted" && part.attemptId === attempt?.attemptId);
  const approvalBatches = batchesFor(pendingApproval);
  const secondsLeft = pendingApproval[0]?.approveBefore ? Math.floor((Date.parse(pendingApproval[0].approveBefore) - clock) / 1000) : 0;
  const tokenRows = useMemo(() => {
    if (!tokens) return [];
    return tokens
      .filter((token) => (token.kind === "solana" ? sol : evm))
      .map((token) => {
        const balance = balances[token.assetId];
        const amount = balance && balance !== "loading" && balance.status === "ok" ? balance.amount : undefined;
        return { token, balance, amount, usd: amount !== undefined ? usdValue(amount, token) : undefined };
      })
      .filter(({ balance, amount }) => balance === "loading" || balance?.status === "error" || (amount !== undefined && amount !== "0"))
      .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.token.symbol.localeCompare(b.token.symbol));
  }, [tokens, balances, sol, evm]);
  const readingBalances = Object.values(balances).some((value) => value === "loading");
  // Tokens Wono picked sit at the top; once the customer edits the mix the order stays put.
  const picked = Object.keys(selection).filter((assetId) => (selection[assetId] ?? 0) > 0).join(",");
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    if (auto) setPinned(picked ? picked.split(",") : []);
  }, [auto, picked]);
  const [search, setSearch] = useState("");
  const [chainFilter, setChainFilter] = useState<string | null>(null);
  const listFade = useScrollFade();
  const chainOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of tokenRows) if (!seen.has(row.token.blockchain)) seen.set(row.token.blockchain, row.token.chainName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [tokenRows]);
  const shownRows = useMemo(() => {
    const rank = (assetId: string) => (pinned.includes(assetId) ? 0 : 1);
    return [...tokenRows].sort((a, b) => rank(a.token.assetId) - rank(b.token.assetId));
  }, [tokenRows, pinned]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return shownRows.filter((row) =>
      (chainFilter === null || row.token.blockchain === chainFilter) &&
      (query === "" || row.token.symbol.toLowerCase().includes(query) || row.token.chainName.toLowerCase().includes(query)),
    );
  }, [shownRows, chainFilter, search]);

  // Auto-pick: until the customer moves a slider, Wono chooses the cheapest mix.
  const autoKey = JSON.stringify([remainingCents, caps, tokenRows.map((row) => [row.token.assetId, row.amount ?? null])]);
  useEffect(() => {
    if (!auto || readingBalances) return;
    const next = autoAllocate(tokenRows, remainingCents, caps);
    setSelection((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoKey captures the inputs
  }, [auto, autoKey, readingBalances]);

  const quoteResults = selected.map(([assetId]) => quotes[assetId]?.result);
  const pricesLoading = quoteResults.some((result) => result === undefined || result === "loading");
  const pricesFailed = quoteResults.some((result) => result && result !== "loading" && !result.ok);
  const overBalance = selected.some(([assetId]) => {
    const result = quotes[assetId]?.result;
    const row = tokenRows.find((entry) => entry.token.assetId === assetId);
    return result && result !== "loading" && result.ok && row?.amount !== undefined && BigInt(result.quote.amountIn) > BigInt(row.amount);
  });
  const payReady = allocationValid && !pricesLoading && !pricesFailed && !overBalance;
  const shortBy = remainingCents - allocatedCents;
  const selectedTokens = selected.map(([assetId]) => tokens?.find((token) => token.assetId === assetId)).filter((token) => token !== undefined);
  const approvalCount = (selectedTokens.some((token) => token.kind === "solana") ? 1 : 0) + selectedTokens.filter((token) => token.kind === "evm").length;
  const routeCost = !pricesLoading && quoteResults.every((result) => result && result !== "loading" && result.ok && result.quote.amountInUsd && result.quote.amountOutUsd)
    ? quoteResults.reduce((sum, result) => (result && result !== "loading" && result.ok ? sum + Number(result.quote.amountInUsd) - Number(result.quote.amountOutUsd) : sum), 0)
    : undefined;
  const spendUsd = !pricesLoading && quoteResults.every((result) => result && result !== "loading" && result.ok && result.quote.amountInUsd)
    ? quoteResults.reduce((sum, result) => (result && result !== "loading" && result.ok ? sum + Number(result.quote.amountInUsd) : sum), 0)
    : undefined;
  const cents = (value: number) => formatUsdc((BigInt(value) * CENT).toString());
  const balanceText = (row: (typeof tokenRows)[number]) =>
    row.balance === "loading" || row.balance === undefined
      ? "Reading balance…"
      : row.balance.status === "error"
        ? "Balance unavailable"
        : `${formatAmount(row.balance.amount, row.token.decimals, 6)} ${row.token.symbol}`;

  // Progress: the routes of this browser's latest attempt, grouped the way wallets approve them.
  const mine = attempt ? visibleParts.filter((part) => part.attemptId === attempt.attemptId && part.state !== "cancelled") : [];
  const myBatches = batchesFor(mine);
  const inProgress = mine.some((part) => part.state !== "expired" && part.state !== "failed" && part.state !== "refunded" && part.state !== "verified");

  function openPay() {
    setError(null);
    setStage(inProgress ? "progress" : sol || evm ? "tokens" : "wallet");
    setOpen(true);
  }

  // Embedded: open straight away; a stored attempt restored after mount jumps to its progress.
  useEffect(() => {
    if (embedded && !autoOpened.current) openPay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded]);
  useEffect(() => {
    if (embedded && open && stage === "wallet" && inProgress) setStage("progress");
  }, [embedded, open, stage, inProgress]);

  async function connectAndContinue(app: WalletApp) {
    if (await connect(app)) setStage("tokens");
  }

  function confirm() {
    setStage("progress");
    void pay();
  }

  const title = { wallet: "Connect wallet", tokens: "Checkout", review: "Review", progress: invoice.state === "paid" ? "Paid" : "Paying" }[stage];

  const selectedRows = selected.map(([assetId]) => tokenRows.find((row) => row.token.assetId === assetId)).filter((row) => row !== undefined);

  /** Add a token; allocation rules live in lib/shared/allocation.ts. */
  function addToken(row: (typeof tokenRows)[number]) {
    setAuto(false);
    const most = Math.min(sliderMax(row.token, row.usd, remainingCents, row.amount), caps[row.token.assetId] ?? Infinity);
    const direct = (id: string) => isSettlementAsset(tokens!.find((token) => token.assetId === id)!);
    setSelection((current) => {
      // Already covered: the new token takes an even share instead of replacing the others.
      const picked = Object.values(current).filter((cents) => cents > 0);
      const covered = picked.reduce((sum, cents) => sum + cents, 0) >= remainingCents;
      const want = covered ? Math.min(most, Math.floor(remainingCents / (picked.length + 1))) : most;
      return addShare(current, remainingCents, row.token.assetId, want, direct);
    });
  }

  // The Pay button and connected wallet: in the summary column on desktop, pinned to the bottom on phones.
  const payAction = () => (
    <>
          <Button className="w-full" leadingIcon={payReady ? RiWallet3Line : undefined} disabled={!payReady || busy !== null} onClick={confirm}>
            {selected.length === 0
              ? "Choose a token"
              : shortBy > 0
                ? `Add ${cents(shortBy)} USDC more`
                : pricesLoading
                  ? "Getting live prices…"
                  : pricesFailed || overBalance
                    ? "Adjust the highlighted token"
                    : `Pay ${spendUsd !== undefined ? `$${spendUsd.toFixed(2)}` : `${formatUsdc(invoice.remaining)} USDC`}${approvalCount > 1 ? ` · ${approvalCount} approvals` : ""}`}
          </Button>
          {sol || evm ? (
            <div className="flex items-center gap-2">
              <WalletIcon src={(sol?.wallet ?? evm!.wallet).icon} className="size-5 rounded-md" />
              <span className="min-w-0 flex-1 truncate text-caption-1-medium text-text-secondary">
                {(sol?.wallet ?? evm!.wallet).name} · {[sol, evm].filter((entry) => entry !== null).map((entry) => shortAddress(entry.address)).join(" · ")}
              </span>
              <Button size="small" variant="ghost" onClick={() => setStage("wallet")}>Change</Button>
            </div>
          ) : null}
    </>
  );

  return (
    <div ref={root} className={cx("mx-auto flex w-full max-w-checkout flex-col gap-4 px-4 py-6", !embedded && "min-h-dvh justify-center")}>
      {embedded ? null : (
      <>
      <Card className="gap-5 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <MerchantAvatar name={invoice.merchantName} logo={invoice.merchantLogo} xl />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-headline-semibold text-text-primary">{invoice.merchantName}</span>
            {invoice.description ? <span className="truncate text-body-regular text-text-tertiary">{invoice.description}</span> : null}
          </div>
          <span className="text-display-4-semibold tabular-nums text-text-primary">{formatUsdc(invoice.amount)} <span className="text-title-3-medium text-text-tertiary">USDC</span></span>
          {invoice.state === "paid" ? <PaidMark title="Paid" detail="Verified on Solana" /> : <InvoiceStatus state={invoice.state} />}
        </div>
        {invoice.state === "open" && payable ? <AnyTokenStrip /> : null}
        {invoice.state !== "open" && invoice.state !== "paid" ? (
          <Details
            rows={[
              { label: "Verified received", value: `${formatUsdc(invoice.credited)} USDC` },
              { label: "In progress", value: `${formatUsdc(invoice.reserved)} USDC` },
              { label: "Still to pay", value: `${formatUsdc(invoice.remaining)} USDC` },
            ]}
          />
        ) : null}
        {invoice.state === "paid" ? (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col divide-y divide-separator-border rounded-2xl bg-background-secondary-default px-4">
              {paidShares.map(({ part, proof }) => (
                <li key={part.id} className="flex items-center gap-3 py-3">
                  <TokenLogo symbol={part.symbol} blockchain={part.chain} chainName={part.chainName} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-medium tabular-nums text-text-primary">{formatUsdc(part.amountOut)} USDC</span>
                    <span className="truncate text-caption-1-regular text-text-tertiary">
                      {part.amountIn ? `${formatAmount(part.amountIn, part.decimals, 6)} ${part.symbol}` : part.symbol} on {part.chainName}
                    </span>
                  </span>
                  {proof ? <ButtonLink href={proof.url} target="_blank" rel="noreferrer" size="small" variant="secondary" trailingIcon={RiExternalLinkLine}>Solscan</ButtonLink> : null}
                </li>
              ))}
            </ul>
            {sharedTx ? (
              <a href={visibleParts.find((part) => part.txUrl)!.txUrl!} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 self-center text-caption-1-medium text-text-tertiary underline-offset-4 hover:text-text-primary hover:underline">
                Sent in 1 Solana transaction <RiExternalLinkLine className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : invoice.expired ? (
          <Notice tone="warning">This invoice has expired. Transfers already in progress are still tracked.</Notice>
        ) : inProgress ? (
          <Button className="w-full" variant="secondary" leadingIcon={RiTimeLine} onClick={openPay}>View payment progress</Button>
        ) : payable ? (
          <Button className="w-full" trailingIcon={RiArrowRightLine} onClick={openPay}>Pay {formatUsdc(invoice.remaining)} USDC</Button>
        ) : null}
      </Card>

      {visibleParts.length > 0 && invoice.state !== "paid" ? (
        <Card title="Transfers" actions={<Button size="small" variant="secondary" leadingIcon={RiRefreshLine} onClick={() => void refresh()}>Refresh</Button>}>
          <ul className="flex flex-col divide-y divide-separator-border">
            {visibleParts.map((part) => (
              <li key={part.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <TokenLogo symbol={part.symbol} blockchain={part.chain} chainName={part.chainName} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-medium text-text-primary">{formatUsdc(part.amountOut)} USDC <span className="text-text-tertiary">via {part.symbol} · {part.chainName}</span></span>
                  <span className="truncate text-caption-1-regular text-text-tertiary">
                    {part.detail ?? (part.amountIn ? `${formatAmount(part.amountIn, part.decimals, 8)} ${part.symbol} from ${shortAddress(part.sourceAddress)}` : shortAddress(part.sourceAddress))}
                  </span>
                  {part.txUrl && !sharedTx ? (
                    <a href={part.txUrl} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-caption-1-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline">
                      Source transaction <RiExternalLinkLine className="size-3.5" aria-hidden />
                    </a>
                  ) : null}
                </span>
                <ContributionStatus state={part.state} />
              </li>
            ))}
          </ul>
          {sharedTx ? (
            <a href={visibleParts.find((part) => part.txUrl)!.txUrl!} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-caption-1-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline">
              Sent together in 1 Solana transaction <RiExternalLinkLine className="size-3.5" aria-hidden />
            </a>
          ) : null}
          {visibleParts.some((part) => part.state === "unknown") ? (
            <Notice tone="warning">A transfer could not be confirmed as sent. It will not be requested again; this page keeps checking Aurora and the chain.</Notice>
          ) : null}
        </Card>
      ) : null}

      {!open && error ? <Notice tone="error">{error}</Notice> : null}

      <footer className="flex flex-col items-center gap-2 pt-2 text-center text-caption-1-regular text-text-tertiary">
        <Logo />
        <span className="flex items-center gap-1"><RiLockLine className="size-3.5" aria-hidden />Keys stay in your wallet · routed by Aurora · verified on Solana</span>
      </footer>
      </>
      )}

      <Modal isOpen={open} onOpenChange={setOpen} size={stage === "tokens" ? "2xl" : "md"} isDismissable={busy === null} className={stage === "tokens" ? "h-pay max-h-full gap-0 py-0" : "h-pay max-h-full gap-3"}>
        {stage === "tokens" ? (
          <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-visible">
            <aside className="flex shrink-0 flex-col gap-4 border-separator-border bg-background-secondary-default p-6 md:w-80 md:border-e">
              <div className="flex items-center gap-2">
                <MerchantAvatar name={invoice.merchantName} logo={invoice.merchantLogo} />
                <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">{invoice.merchantName}</span>
              </div>
              {invoice.description ? <span className="text-body-regular text-text-secondary">{invoice.description}</span> : null}
              <span className="text-display-4-semibold tabular-nums text-text-primary">
                {formatUsdc(invoice.remaining)} <span className="text-title-3-medium text-text-tertiary">USDC</span>
              </span>
              <div className="flex flex-col gap-2">
                <div className="flex h-1.5 overflow-hidden rounded-full bg-background-tertiary-default" aria-hidden>
                  {selectedRows.map((row, index) => (
                    <span key={row.token.assetId} className={cx("h-full transition-[width]", SHARE_COLORS[index % SHARE_COLORS.length])} style={{ width: `${remainingCents ? ((selection[row.token.assetId] ?? 0) / remainingCents) * 100 : 0}%` }} />
                  ))}
                </div>
                <div className="flex items-center justify-between text-caption-1-medium tabular-nums">
                  {shortBy > 0
                    ? <span className="text-text-secondary">{cents(shortBy)} USDC left</span>
                    : <span className="flex items-center gap-1 text-status-lime-text"><RiCheckboxCircleLine className="size-4" aria-hidden />Covered</span>}
                  <span className="text-text-tertiary">{cents(allocatedCents)} / {formatUsdc(invoice.remaining)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {selectedRows.map((row, index) => {
                  const result = quotes[row.token.assetId]?.result;
                  return (
                    <div key={row.token.assetId} className="flex items-center gap-2 text-body-regular tabular-nums">
                      <span className={cx("size-2 shrink-0 rounded-full", SHARE_COLORS[index % SHARE_COLORS.length])} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-text-secondary">
                        {result && result !== "loading" && result.ok ? `${amountText(result.quote.amountIn, row.token.decimals)} ${row.token.symbol}` : row.token.symbol}
                        <span className="text-text-tertiary"> · {row.token.chainName}</span>
                      </span>
                      <span className="text-text-primary">{cents(selection[row.token.assetId] ?? 0)} USDC</span>
                    </div>
                  );
                })}
                {selectedRows.length > 0 ? (
                  <>
                    <Line label="Route fees" value={routeCost !== undefined ? (routeCost >= 0.0005 ? usdFee(routeCost) : "None") : "…"} />
                    {selectedTokens.length ? (
                      <Line
                        label="Network fee"
                        value={
                          selectedTokens.some((token) => token.kind === "evm")
                            ? invoice.solanaGasSponsored && selectedTokens.some((token) => token.kind === "solana") ? "Solana paid by Wono · EVM gas in wallet" : "Gas from your wallet"
                            : invoice.solanaGasSponsored ? "Paid by Wono" : "~$0.001 from your wallet"
                        }
                      />
                    ) : null}
                    <div className="h-px bg-separator-border" />
                    <Line label="Total" value={spendUsd !== undefined ? `~$${spendUsd.toFixed(2)}` : "…"} strong />
                  </>
                ) : null}
              </div>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <div className="mt-auto hidden flex-col gap-3 pt-2 md:flex">
                {payAction()}
              </div>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col gap-3 p-6 md:min-h-0">
              <PaneHeader title="Pay with" closable={busy === null} trailing={<span className="hidden text-caption-1-regular text-text-tertiary sm:inline">Tick one or more</span>} />
              {tokensError ? <Notice tone="error">Token list unavailable: {tokensError}</Notice> : null}
              {tokenRows.length > 6 ? (
                <Input aria-label="Search tokens" placeholder="Search tokens" leadingIcon={RiSearchLine} value={search} onChange={setSearch} />
              ) : null}
              {chainOptions.length > 1 ? <ChainFilter chains={chainOptions} value={chainFilter} onChange={setChainFilter} /> : null}
              {readingBalances ? (
                <span className="flex items-center gap-2 text-caption-1-medium text-text-tertiary"><Spinner size="xs" aria-hidden />Reading your balances…</span>
              ) : null}
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div onScroll={listFade.onScroll} className="min-h-0 flex-1 overscroll-contain md:overflow-y-auto">
                    <ul className="flex flex-col gap-2 pb-1">
                      {visibleRows.map((row) => {
                        const share = selection[row.token.assetId] ?? 0;
                        const result = quotes[row.token.assetId]?.result;
                        const cap = caps[row.token.assetId];
                        const tooSmall = cap === 0 || (row.usd !== undefined && row.usd < DUST_USD);
                        return (
                          <TokenRow
                            key={row.token.assetId}
                            token={row.token}
                            balanceText={row.amount !== undefined ? `${amountText(row.amount, row.token.decimals)} ${row.token.symbol}` : balanceText(row)}
                            valueText={row.usd !== undefined ? usdText(row.usd) : undefined}
                            selected={share > 0}
                            disabled={share === 0 && (tooSmall || row.amount === undefined)}
                            disabledReason={tooSmall ? "Smaller than route costs" : undefined}
                            cents={share}
                            maxCents={Math.min(sliderMax(row.token, row.usd, remainingCents, row.amount), cap ?? Infinity)}
                            spend={result && result !== "loading" && result.ok
                              ? `You send ${amountText(result.quote.amountIn, row.token.decimals)} ${row.token.symbol} · ${result.quote.direct ? "no fee" : feeUsd(result.quote) !== undefined ? `fee ${usdFee(feeUsd(result.quote)!)}` : "fee included"}`
                              : undefined}
                            pricing={result === "loading" || result === undefined}
                            problem={result && result !== "loading" && !result.ok ? result.error : undefined}
                            onToggle={() => (share > 0 ? (setAuto(false), setShare(row.token.assetId, 0)) : addToken(row))}
                            onChange={(value) => { setAuto(false); setShare(row.token.assetId, value); }}
                          />
                        );
                      })}
                    </ul>
                  {tokenRows.length === 0 && !readingBalances ? <Notice>No supported tokens with a balance in the connected wallets.</Notice> : null}
                  {tokenRows.length > 0 && visibleRows.length === 0 ? <span className="text-body-regular text-text-tertiary">No tokens match.</span> : null}
                </div>
                <ScrollFade progress={listFade.progress} />
              </div>
            </section>
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-separator-border p-4 md:hidden">
            {payAction()}
          </div>
          </>
        ) : (
        <>
        <PayHeader
          title={title}
          closable={busy === null}
          onBack={stage === "review" ? () => setStage("tokens") : undefined}
        />

        <ModalBody className="flex flex-col gap-4">
          <MotionConfig reducedMotion="user">
          <motion.div key={stage} className="flex flex-col gap-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
          {stage === "review" ? (
            <AmountHero merchant={invoice.merchantName} logo={invoice.merchantLogo} amount={formatUsdc(invoice.remaining)} />
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}

          {stage === "wallet" ? (
            <div className="flex flex-col gap-2">
              {walletApps.map((app) => (
                <WalletRow
                  key={app.key}
                  name={app.name}
                  icon={app.icon}
                  chains={[app.sol ? "Solana" : null, app.evm ? "EVM" : null].filter((chain) => chain !== null)}
                  connected={Boolean((!app.sol || sol?.wallet === app.sol) && (!app.evm || evm?.wallet === app.evm))}
                  busy={busy === `connect:${app.key}`}
                  disabled={busy !== null}
                  onPress={() => void connectAndContinue(app)}
                />
              ))}
              {walletApps.length === 0 ? <OpenInWalletApp invoiceId={invoice.id} /> : null}
              {sol || evm ? (
                <Button size="small" variant="ghost" className="self-center" onClick={() => { setSol(null); setEvm(null); setSelection({}); setAuto(true); }}>
                  Disconnect
                </Button>
              ) : null}
            </div>
          ) : null}

          {stage === "review" ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-body-semibold text-text-primary">You send</span>
                <ul className="flex flex-col gap-2">
                  {selectedRows.map((row) => {
                    const result = quotes[row.token.assetId]?.result;
                    return result && result !== "loading" && result.ok ? (
                      <li key={row.token.assetId} className="flex items-center gap-3 rounded-2xl bg-background-secondary-default p-3">
                        <RouteHop token={row.token} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-body-medium tabular-nums text-text-primary">{amountText(result.quote.amountIn, row.token.decimals)} {row.token.symbol}</span>
                          <span className="truncate text-caption-1-regular text-text-tertiary">{result.quote.direct ? "Direct · no fee" : `Aurora · $${(feeUsd(result.quote) ?? 0).toFixed(2)} fee`}</span>
                        </span>
                        {result.quote.amountInUsd ? <span className="text-body-medium tabular-nums text-text-secondary">{usdText(Number(result.quote.amountInUsd))}</span> : null}
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-border-button-default p-4">
                {spendUsd !== undefined ? <Line label="Total value" value={`~$${spendUsd.toFixed(2)}`} /> : null}
                <Line label="Fees" value={routeCost !== undefined ? `~$${routeCost.toFixed(2)}` : "—"} />
                <Line
                  label="Network gas"
                  value={
                    selectedTokens.some((token) => token.kind === "evm")
                      ? invoice.solanaGasSponsored && selectedTokens.some((token) => token.kind === "solana") ? "Solana free · EVM in wallet" : "In your wallet"
                      : invoice.solanaGasSponsored ? "Free" : "~$0.001"
                  }
                />
                <Line label="Approvals" value={`${approvalCount}`} />
                <div className="my-1 h-px bg-separator-border" />
                <Line label={`${invoice.merchantName} receives`} value={`${formatUsdc(invoice.remaining)} USDC`} strong />
              </div>
            </>
          ) : null}

          {stage === "progress" && invoice.state === "paid" ? (
            <PaidMark title={`${formatUsdc(invoice.amount)} USDC paid`} detail={`${invoice.merchantName} received it. Verified on Solana.`} />
          ) : null}
          {stage === "progress" ? (
            <ol className="flex flex-col gap-2">
              <Step state={busy === "prepare" ? "active" : mine.length > 0 ? "done" : error ? "failed" : "pending"} title="Lock prices" detail={mine.length === 0 ? undefined : mine.some((part) => part.depositAddress) ? "Routes reserved with Aurora." : "Transfer prepared."} />
              {myBatches.map((batch) => {
                const first = batch[0]!;
                const wallet = first.chain === "sol" ? sol?.wallet.name : evm?.wallet.name;
                const label = first.chain === "sol"
                  ? `Approve on Solana${batch.length > 1 ? ` · ${batch.length} tokens` : ` · ${first.symbol}`}`
                  : `Approve on ${first.chainName} · ${first.symbol}`;
                const states = batch.map((part) => part.state);
                const total = batch.reduce((sum, part) => sum + BigInt(part.amountOut), 0n);
                const state: StepState = states.every((value) => value === "verified")
                  ? "done"
                  : states.some((value) => value === "failed" || value === "expired")
                    ? "failed"
                    : states.some((value) => value === "refunded" || value === "unknown")
                      ? "warning"
                      : states.every((value) => value === "quoted") && busy !== `approve:${first.id}`
                        ? first.detail ? "warning" : "pending"
                        : "active";
                const detail = busy === `approve:${first.id}`
                  ? `Confirm in ${wallet ?? "your wallet"}…`
                  : states.every((value) => value === "verified")
                    ? `${formatUsdc(total.toString())} USDC delivered`
                    : states.some((value) => value === "submitted" || value === "processing" || value === "settled")
                      ? `Delivering ${formatUsdc(total.toString())} USDC…`
                      : first.detail ?? undefined;
                return (
                  <Step key={first.id} state={state} title={label} detail={detail}>
                    {states.every((value) => value === "quoted") && busy === null && secondsLeft > 30 ? (
                      <Button size="small" className="self-start" leadingIcon={RiWallet3Line} onClick={() => void approve(batch)}>Approve</Button>
                    ) : null}
                  </Step>
                );
              })}
              <Step
                state={invoice.state === "paid" ? "done" : invoice.state === "partial" ? "warning" : "pending"}
                title={`${invoice.merchantName} receives ${formatUsdc(invoice.amount)} USDC`}
                detail={invoice.state === "paid" ? "Verified on Solana." : invoice.state === "partial" ? `${formatUsdc(invoice.credited)} USDC received so far.` : "Confirmed on Solana before it counts."}
              />
            </ol>
          ) : null}
          </motion.div>
          </MotionConfig>
        </ModalBody>

        <ModalFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {stage === "wallet" ? (
            <Button className="w-full" trailingIcon={RiArrowRightLine} disabled={!sol && !evm} onClick={() => setStage("tokens")}>Continue</Button>
          ) : null}
          {stage === "review" ? (
            <Button className="w-full" leadingIcon={RiWallet3Line} disabled={!payReady || busy !== null} onClick={confirm}>
              Pay {formatUsdc(invoice.remaining)} USDC
            </Button>
          ) : null}
          {stage === "progress" ? (
            <>
              {approvalBatches.length > 0 && secondsLeft > 0 ? (
                <span className="text-center text-caption-1-regular text-text-tertiary">Prices held for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</span>
              ) : null}
              <Button className="w-full" variant={invoice.state === "paid" ? "primary" : "secondary"} disabled={busy !== null} onClick={() => setOpen(false)}>
                {invoice.state === "paid" ? "Done" : "Close"}
              </Button>
            </>
          ) : null}
          <span className="flex items-center justify-center gap-1 text-caption-1-regular text-text-tertiary">
            <RiLockLine className="size-3.5" aria-hidden />Keys stay in your wallet
          </span>
        </ModalFooter>
        </>
        )}
      </Modal>
    </div>
  );
}

interface WalletApp {
  key: string;
  name: string;
  icon: string;
  sol?: SolanaWallet;
  evm?: EvmWallet;
}

/** Merge the Solana and EVM providers that one wallet app announces into one entry. */
function groupWallets(solWallets: SolanaWallet[], evmWallets: EvmWallet[]): WalletApp[] {
  const apps = new Map<string, WalletApp>();
  const keyOf = (name: string) => name.trim().toLowerCase();
  for (const wallet of solWallets) apps.set(keyOf(wallet.name), { key: keyOf(wallet.name), name: wallet.name, icon: wallet.icon, sol: wallet });
  for (const wallet of evmWallets) {
    const key = keyOf(wallet.name);
    const app = apps.get(key);
    if (app && !app.evm) app.evm = wallet;
    else if (!app) apps.set(key, { key, name: wallet.name, icon: wallet.icon, evm: wallet });
  }
  return [...apps.values()];
}

/** No wallet in this browser: offer to reopen the checkout inside a wallet app's own browser. */
function OpenInWalletApp({ invoiceId }: { invoiceId: string }) {
  const pageUrl = `${window.location.origin}/pay/${invoiceId}`;
  if (!isPublicUrl(pageUrl)) {
    return <Notice>No wallet found in this browser. Install Phantom, Solflare or Backpack (Solana) or MetaMask, Rabby or Coinbase Wallet (EVM), then reload.</Notice>;
  }
  return (
    <>
      <span className="text-caption-1-medium text-text-tertiary">No wallet in this browser. Open this checkout in your wallet app:</span>
      {walletAppLinks(pageUrl).map((link) => <WalletAppLink key={link.key} name={link.name} icon={`/icons/wallets/${link.key}.svg`} chains={link.chains} href={link.href} />)}
    </>
  );
}

/** What makes this checkout different, at a glance: any chain in, USDC on Solana out. */
function AnyTokenStrip() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-background-secondary-default p-3">
      <span className="flex shrink-0 -space-x-2" aria-hidden>
        {SOURCE_CHAINS.slice(0, 5).map((chain, index) => (
          <motion.img
            key={chain.blockchain}
            src={`/icons/chains/${chain.blockchain}.svg`}
            alt=""
            className="size-6 rounded-full bg-background-primary-default ring-2 ring-background-secondary-default"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * index, duration: 0.25 }}
          />
        ))}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-medium text-text-primary">Pay with tokens on {SOURCE_CHAINS.length} chains</span>
        <span className="truncate text-caption-1-regular text-text-tertiary">Arrives as USDC on Solana</span>
      </span>
    </div>
  );
}
