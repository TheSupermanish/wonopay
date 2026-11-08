"use client";

/**
 * Wono checkout for React: a pay modal over your page.
 *
 *   const [open, setOpen] = useState(false);
 *   <button onClick={() => setOpen(true)}>Pay</button>
 *   <WonoCheckout invoiceId={invoice.id} open={open} onClose={() => setOpen(false)} onStatus={() => router.refresh()} />
 *
 * Create the invoice on your server with `@wono/sdk` and add your site's origin under
 * Dashboard → Settings → Embed origins. `onStatus` is a hint that something changed:
 * fulfil only after your server reads `state === "paid"` from Wono.
 *
 * No account? `Pay` (below), e.g. `<Pay to="…" amount="5" />`, collects for any Solana wallet with no API key.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPayLink, getInvoice, isPaidTo, type Invoice } from "@wono/sdk";

export type WonoInvoiceState = "open" | "partial" | "paid" | (string & {});

export interface WonoCheckoutProps {
  invoiceId: string;
  /** Show the pay modal. */
  open: boolean;
  /** The customer closed the modal (Done, Close, Escape or the backdrop). */
  onClose: () => void;
  /** Wono deployment. Defaults to https://wonopay.vercel.app. */
  baseUrl?: string;
  /** Checkout loaded and ready. */
  onReady?: () => void;
  /** Invoice state as the checkout sees it. A hint only: confirm on your server before fulfilling. */
  onStatus?: (state: WonoInvoiceState) => void;
  theme?: "light" | "dark";
  title?: string;
}

interface CheckoutMessage {
  type?: unknown;
  state?: unknown;
  invoiceId?: unknown;
}

export function WonoCheckout({ invoiceId, open, onClose, baseUrl = "https://wonopay.vercel.app", onReady, onStatus, theme = "light", title = "Pay with Wono" }: WonoCheckoutProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const handlers = useRef({ onReady, onStatus, onClose });
  handlers.current = { onReady, onStatus, onClose };
  const wonoOrigin = new URL(baseUrl).origin;

  // The embed checks `parent` against the merchant's allowed origins; it is only known in the browser.
  useEffect(() => {
    const params = new URLSearchParams({ parent: window.location.origin, theme });
    setSrc(`${wonoOrigin}/embed/${encodeURIComponent(invoiceId)}?${params}`);
  }, [wonoOrigin, invoiceId, theme]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== wonoOrigin || event.source !== frame.current?.contentWindow) return;
      const data = (event.data ?? {}) as CheckoutMessage;
      if (data.invoiceId !== undefined && data.invoiceId !== invoiceId) return;
      if (data.type === "wono:ready") handlers.current.onReady?.();
      if (data.type === "wono:close") handlers.current.onClose();
      if (data.type === "wono:status" && typeof data.state === "string") handlers.current.onStatus?.(data.state);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [wonoOrigin, invoiceId]);

  // The page behind the modal stops scrolling while it is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    frame.current?.focus();
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  if (!open || !src) return null;
  return (
    <iframe
      ref={frame}
      title={title}
      src={src}
      allow="clipboard-write"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, zIndex: 2147483000, background: "transparent", colorScheme: theme }}
    />
  );
}

export interface PayProps {
  /** Solana wallet that receives USDC. No Wono account or API key needed. */
  to: string;
  /** USDC amount, e.g. "5" or "2.50". Minimum 1. */
  amount: string;
  description?: string;
  /** Name shown to the payer at checkout. */
  name?: string;
  reference?: string;
  baseUrl?: string;
  theme?: "light" | "dark";
  className?: string;
  children?: ReactNode;
  /** The invoice re-read from Wono is paid to `to` for `amount`. Never taken from the iframe alone. */
  onPaid?: (invoice: Invoice) => void;
  onError?: (error: Error) => void;
}

/**
 * Keyless pay button for any Solana wallet: creates a payment link for `to` on click, then opens checkout.
 *
 *   <Pay to="5bPg…ci17" amount="3" description="Coffee">Buy me a coffee</Pay>
 *
 * `onPaid` is fine for a thank-you. To unlock something valuable, check on your server with
 * `getInvoice(id, { refresh: true })` and `isPaidTo` from `@wono/sdk`.
 */
export function Pay({ to, amount, description, name, reference, baseUrl = "https://wonopay.vercel.app", theme = "light", className, children, onPaid, onError }: PayProps) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const paid = useRef(false);

  async function start() {
    if (invoiceId) return setOpen(true);
    setBusy(true);
    try {
      const invoice = await createPayLink(
        { to, amount, ...(description ? { description } : {}), ...(name ? { name } : {}), ...(reference ? { reference } : {}) },
        { baseUrl },
      );
      setInvoiceId(invoice.id);
      setOpen(true);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function check(state: WonoInvoiceState) {
    if (state !== "paid" || !invoiceId || paid.current) return;
    const invoice = await getInvoice(invoiceId, { baseUrl, refresh: true });
    if (isPaidTo(invoice, { to, amount }) && !paid.current) {
      paid.current = true;
      onPaid?.(invoice);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void start()} disabled={busy} aria-busy={busy}>
        {children ?? `Pay $${amount}`}
      </button>
      {invoiceId ? (
        <WonoCheckout
          invoiceId={invoiceId}
          baseUrl={baseUrl}
          theme={theme}
          open={open}
          onClose={() => setOpen(false)}
          onStatus={(state) => void check(state).catch(() => undefined)}
        />
      ) : null}
    </>
  );
}
