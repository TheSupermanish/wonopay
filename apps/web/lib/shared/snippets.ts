export function embedSnippet(origin: string, invoiceId: string, parentOrigin: string): string {
  return `<iframe
  id="wono-checkout"
  src="${origin}/embed/${invoiceId}?parent=${encodeURIComponent(parentOrigin)}"
  title="Pay with Wono"
  style="width:100%;max-width:460px;height:720px;border:0;"
></iframe>
<script>
  const WONO_ORIGIN = "${origin}";
  const frame = document.getElementById("wono-checkout");
  window.addEventListener("message", (event) => {
    // Accept messages only from Wono's origin AND from this exact iframe.
    if (event.origin !== WONO_ORIGIN || event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "wono:resize" && Number.isFinite(data.height)) {
      frame.style.height = Math.min(Math.max(data.height, 320), 2000) + "px";
    }
    if (data.type === "wono:status") {
      // Display hint only. Never fulfil from this event or a return URL:
      // ask your server, which calls GET ${origin}/api/v1/invoices/${invoiceId}
    }
  });
</script>`;
}

export function verifySnippet(origin: string, invoiceId: string): string {
  return `// Server-side only. Fulfil the order only when state === "paid".
const response = await fetch("${origin}/api/v1/invoices/${invoiceId}?refresh=1", {
  headers: { Authorization: \`Bearer \${process.env.WONO_API_KEY}\` },
});
const invoice = await response.json();
if (invoice.state === "paid" && invoice.id === "${invoiceId}") {
  // invoice.credited is verified, finalized USDC (base units) in your wallet.
}`;
}

/** Copy-ready SDK quickstart for the Developers page. */
export function sdkSnippets(origin: string): { install: string; server: string; client: string; confirm: string } {
  return {
    install: "npm install @wono/sdk @wono/react",
    server: `// Server: one invoice per order. The key stays here.
import { Wono } from "@wono/sdk";

const wono = new Wono({
  apiKey: process.env.WONO_API_KEY!,
  baseUrl: "${origin}",
});
const invoice = await wono.invoices.create({
  amount: "25.00",
  reference: "order-42",
});
// Send invoice.id to the browser.`,
    client: `// Browser: open checkout for that invoice.
import { WonoCheckout } from "@wono/react";

<WonoCheckout
  invoiceId={invoiceId}
  baseUrl="${origin}"
  open={open}
  onClose={() => setOpen(false)}
/>`,
    confirm: `// Server: fulfil only when Wono has verified the USDC on Solana.
const latest = await wono.invoices.retrieve(invoiceId, {
  refresh: true,
});
if (latest.state === "paid") {
  // latest.credited is finalized USDC (base units) in your wallet.
}`,
  };
}
