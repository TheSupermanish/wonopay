# Solana payments starter

Take payment in any token, receive native USDC on Solana. This uses Wono, which routes
each token through Aurora Intents and marks a payment paid only after it verifies the
USDC credit on Solana.

## 1. Install

    npm install @wono/sdk @wono/react

## 2. Create a payment on your server

    import { Wono } from "@wono/sdk";

    const wono = new Wono({ apiKey: process.env.WONO_API_KEY!, baseUrl: process.env.WONO_URL });
    const invoice = await wono.invoices.create({ amount: "25.00", reference: "order-42" });

Keep the API key on the server. Send `invoice.id` to the browser.

## 3. Open checkout in the browser

    import { WonoCheckout } from "@wono/react";

    <WonoCheckout invoiceId={invoiceId} baseUrl={wonoUrl} open={open} onClose={() => setOpen(false)} />

Customers connect Phantom, Solflare, MetaMask or Coinbase, tick one or more tokens on
eight chains, and approve in their wallet. USDC on Solana goes straight to you; every
other token gets its own Aurora route.

## 4. Fulfil only when paid

    const latest = await wono.invoices.retrieve(invoiceId, { refresh: true });
    if (latest.state === "paid") {
      // finalized USDC is in your wallet
    }

Never trust a redirect or a browser event. Ask your server, which asks Wono.

## Things worth knowing

- One customer wallet signs one Solana transaction for all of its Solana tokens.
- A token paid through Aurora usually lands in one to three minutes.
- `partial` means some USDC arrived and the rest is still due. Wait before fulfilling.
- Aurora refunds a failed route to the wallet that paid it.
