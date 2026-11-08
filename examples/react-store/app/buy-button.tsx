"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { WonoCheckout } from "@wono/react";
import { startOrder } from "./actions";

/**
 * Buy opens Wono's pay modal right over this page, like `<Pay>` from @wono/react.
 * When the checkout reports paid, the order page re-reads the invoice from Wono on the
 * server (recipient, amount, paid) before it unlocks anything.
 */
export function BuyButton({ product, amount, wonoUrl, className, label, children }: { product: string; amount?: string; wonoUrl: string; className: string; label: string; children: ReactNode }) {
  const router = useRouter();
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  async function start() {
    if (invoiceId) return setOpen(true);
    setBusy(true);
    try {
      setInvoiceId(await startOrder(product, amount));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} aria-label={label} onClick={() => void start()} disabled={busy} aria-busy={busy}>
        {children}
      </button>
      {invoiceId ? createPortal(
        <WonoCheckout
          invoiceId={invoiceId}
          baseUrl={wonoUrl}
          theme={theme}
          open={open}
          onClose={() => setOpen(false)}
          onStatus={(state) => { if (state === "paid") router.push(`/order/${invoiceId}`); }}
        />,
        // The tiles tilt on hover; a transformed ancestor would trap the fixed-position modal.
        document.body,
      ) : null}
    </>
  );
}
