"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WonoCheckout } from "@wono/react";

/** The page's own Pay button opens Wono's pay modal. Status messages only trigger a server re-read of the invoice. */
export function Checkout({ invoiceId, wonoUrl, label }: { invoiceId: string; wonoUrl: string; label: string }) {
  const router = useRouter();
  // Arriving from a Buy button opens the modal straight away.
  const [open, setOpen] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    setTheme(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }, []);
  return (
    <>
      <button type="button" className="cta" onClick={() => setOpen(true)}>{label}</button>
      <WonoCheckout invoiceId={invoiceId} baseUrl={wonoUrl} theme={theme} open={open} onClose={() => { setOpen(false); router.refresh(); }} onStatus={() => router.refresh()} />
    </>
  );
}
