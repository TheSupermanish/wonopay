/**
 * Example merchant store integrating Wono. Zero dependencies; run with Node ≥ 22.18:
 *
 *   WONO_API_KEY=wono_sk_… node examples/store/server.ts
 *
 * It shows the whole integration a shop needs:
 *   1. Server creates an invoice with the secret API key (POST /api/v1/invoices).
 *   2. The page embeds Wono checkout in an iframe (origin-locked by `parent`).
 *   3. Iframe messages only trigger a check; the order is fulfilled only when the
 *      server reads `state: "paid"` from Wono's API (a verified Solana credit).
 *
 * Add this store's origin (default http://127.0.0.1:3090) under Wono Settings → Embed origins.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

const WONO_URL = (process.env.WONO_URL ?? "http://127.0.0.1:3080").replace(/\/$/, "");
const API_KEY = process.env.WONO_API_KEY ?? "";
const PORT = Number(process.env.STORE_PORT ?? 3090);
const ORIGIN = process.env.STORE_ORIGIN ?? `http://127.0.0.1:${PORT}`;
const PRODUCT = {
  name: process.env.STORE_PRODUCT ?? "Field Notes, 3-pack",
  price: process.env.STORE_PRICE ?? "1.00",
};

if (!API_KEY.startsWith("wono_sk_")) {
  console.error("Set WONO_API_KEY to a key from Wono → Settings → Server API key.");
  process.exit(1);
}

interface WonoInvoice {
  id: string;
  state: string;
  amount: string;
  remaining: string;
  decimals: number;
  checkoutUrl?: string;
}

async function wono(path: string, init: RequestInit = {}): Promise<WonoInvoice> {
  const response = await fetch(`${WONO_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json", ...init.headers },
  });
  const data = await response.json() as WonoInvoice & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Wono API ${response.status}`);
  return data;
}

/** Base units to a decimal string, e.g. ("1000000", 6) -> "1.00". */
function units(amount: string, decimals: number): string {
  const value = BigInt(amount);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${value / scale}.${fraction}`;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%232f4a3a%22/%3E%3Crect x=%229%22 y=%227%22 width=%2214%22 height=%2218%22 rx=%222%22 fill=%22%23e9dfc8%22/%3E%3C/svg%3E">
<style>
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; background: #fff; color: #111; }
  body { margin: 0; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #eee; background: #fff; }
  header strong { font-size: 18px; letter-spacing: -0.01em; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px; display: grid; gap: 24px; }
  .card { background: #fff; border: 1px solid #eee; border-radius: 20px; padding: 24px; display: grid; gap: 12px; }
  .product { display: grid; grid-template-columns: 160px 1fr; gap: 24px; align-items: center; }
  .art { aspect-ratio: 1; border-radius: 16px; background: #f4f4f5; }
  h1, h2 { margin: 0; }
  p { margin: 0; color: #5c5850; }
  .price { font-size: 24px; font-weight: 600; }
  button, .button { font: inherit; font-weight: 600; border: 0; border-radius: 12px; padding: 12px 20px; background: #111; color: #fff; cursor: pointer; text-decoration: none; justify-self: start; }
  .order { max-width: 480px; width: 100%; margin: 0 auto; }
  #wono-checkout { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 2147483000; background: transparent; color-scheme: light; }
  .status { font-weight: 600; }
  .paid { color: #1a7f37; }
  code { font-size: 13px; background: #f4f4f5; padding: 2px 6px; border-radius: 6px; }
  @media (max-width: 720px) { .product { grid-template-columns: 1fr; } }
</style></head><body>
<header><strong>Field &amp; Ink</strong></header>
<main>${body}</main></body></html>`;
}

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function home(): string {
  return page("Field & Ink", `
<section class="card product">
  <div class="art" aria-hidden="true"></div>
  <div style="display:grid;gap:12px">
    <h1>${escape(PRODUCT.name)}</h1>
    <p>Pocket notebooks, 48 pages of dot grid each.</p>
    <span class="price">${escape(PRODUCT.price)} USDC</span>
    <form method="post" action="/checkout"><button type="submit">Buy now</button></form>
  </div>
</section>`);
}

function order(invoice: WonoInvoice): string {
  const embed = `${WONO_URL}/embed/${encodeURIComponent(invoice.id)}?parent=${encodeURIComponent(ORIGIN)}&theme=light`;
  return page(`Order ${invoice.id}`, `
<section class="order">
  <div class="card">
    <h2>Your order</h2>
    <p>${escape(PRODUCT.name)} · ${escape(units(invoice.amount, invoice.decimals))} USDC</p>
    <p>Order status: <span class="status" id="status">${invoice.state === "paid" ? "Paid" : invoice.state === "partial" ? "Partly paid" : "Awaiting payment"}</span></p>
    <button type="button" id="pay">Pay ${escape(units(invoice.remaining, invoice.decimals))} USDC</button>
  </div>
</section>
<script>
  const WONO_ORIGIN = ${JSON.stringify(WONO_URL)};
  const EMBED = ${JSON.stringify(embed)};
  let frame = null;
  // Wono's pay modal opens in a full-window frame over this page; closing it removes the frame.
  function openPay() {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.id = "wono-checkout";
    frame.title = "Pay with Wono";
    frame.allow = "clipboard-write";
    frame.src = EMBED;
    document.body.appendChild(frame);
    document.documentElement.style.overflow = "hidden";
  }
  function closePay() {
    frame?.remove();
    frame = null;
    document.documentElement.style.overflow = "";
    check();
  }
  document.getElementById("pay").addEventListener("click", openPay);
  if (${JSON.stringify(invoice.state)} !== "paid") openPay();
  const status = document.getElementById("status");
  async function check() {
    const response = await fetch(${JSON.stringify(`/order/${invoice.id}/status`)}, { cache: "no-store" });
    const data = await response.json();
    status.textContent = data.state === "paid" ? "Paid" : data.state === "partial" ? "Partly paid" : "Awaiting payment";
    status.className = "status" + (data.state === "paid" ? " paid" : "");
    return data.state;
  }
  window.addEventListener("message", (event) => {
    if (!frame || event.origin !== WONO_ORIGIN || event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "wono:close") closePay();
    if (data.type === "wono:status") check();
  });
  const timer = setInterval(async () => { if ((await check()) === "paid") clearInterval(timer); }, 15000);
</script>`);
}

async function readForm(req: IncomingMessage): Promise<void> {
  for await (const _ of req) { /* body unused */ }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", ORIGIN);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, home());
    if (req.method === "POST" && url.pathname === "/checkout") {
      await readForm(req);
      const invoice = await wono("/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({ amount: PRODUCT.price, description: PRODUCT.name, reference: `order-${randomBytes(4).toString("hex")}`, expiresInHours: 24 }),
      });
      res.writeHead(303, { location: `/order/${encodeURIComponent(invoice.id)}` });
      return res.end();
    }
    const match = url.pathname.match(/^\/order\/([\w-]+)(\/status)?$/);
    if (req.method === "GET" && match) {
      const invoice = await wono(`/api/v1/invoices/${encodeURIComponent(match[1]!)}${match[2] ? "?refresh=1" : ""}`);
      if (match[2]) return send(res, 200, JSON.stringify({ state: invoice.state }), "application/json");
      return send(res, 200, order(invoice));
    }
    send(res, 404, page("Not found", `<section class="card"><h2>Not found</h2><a class="button" href="/">Back to the shop</a></section>`));
  } catch (error) {
    send(res, 502, page("Error", `<section class="card"><h2>Checkout unavailable</h2><p>${escape(error instanceof Error ? error.message : String(error))}</p><a class="button" href="/">Back to the shop</a></section>`));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Example store on ${ORIGIN} (Wono at ${WONO_URL})`));
