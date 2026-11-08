# Settlement architecture decision

Status: **direct per-contribution settlement is implemented.** Customer-controlled
Intents collection is investigated, partly proven against the live API, and not shipped.

## Question

Can several contributions (for example 12 USDC from Base and 8 USDC worth of SOL)
collect in a customer-controlled NEAR Intents balance first, and then pay the merchant
once, in full?

## What was tested live (2026-11-05, Aurora Intents Swap API)

All requests used `swapType: EXACT_OUTPUT` with Solana USDC
(`nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near`, mint `EPjF…Dt1v`).

| Leg | Request | Result |
| --- | --- | --- |
| Direct | Base USDC → Solana USDC, `recipientType: DESTINATION_CHAIN`, dry and non-dry | 200. Non-dry returns a deposit address; status `PENDING_DEPOSIT`. |
| Direct | SOL → Solana USDC, `DESTINATION_CHAIN` | 200. |
| Collect | Base ETH → USDC, `recipientType: INTENTS`, recipient = customer EVM address | 200, `withdrawFee: 0`. |
| Collect | SOL → USDC, `recipientType: INTENTS`, recipient = 64-hex implicit account of a Solana key | 200, `withdrawFee: 0`. |
| Payout | `depositType: INTENTS`, USDC (Intents) → USDC on Solana, `DESTINATION_CHAIN` | 200, dry and non-dry. Non-dry returns a 64-hex Intents deposit account. |

So both halves quote: contributions can be routed into an Intents account the customer's
key controls, and a single Intents-funded quote can pay the merchant on Solana.

## What is not proven

1. **Funding the payout quote.** With `depositType: INTENTS` the customer must move the
   Intents balance to the quote's deposit account. Aurora documents a signed transfer
   intent only for `CONFIDENTIAL_INTENTS`; for public `INTENTS` the mechanism (signed
   `transfer` intent published through the solver relay) is not documented by Aurora and
   was not exercised. It needs the customer's wallet to sign an ERC-191 or raw-ed25519
   intent, and a funded account to test.
2. **One controlling key across chains.** A Base wallet controls `0x…` and a Solana
   wallet controls a different implicit account. Collecting from both into one account
   requires routing every leg to a single account and having that key sign the payout.
3. **Abandonment.** If the customer funds the Intents account and never signs the
   payout, the money stays the customer's (correct), and Wono would need a withdrawal UI.

None of this is atomic either: the collection legs settle independently into the
customer's account. What collection buys is that the *merchant* is paid once, in full,
or not at all.

## Decision

Ship direct settlement: each contribution is its own Aurora route paying the merchant's
Solana wallet. This is the only path verifiable end to end today (deposit → Aurora →
finalized SPL credit to the merchant). The product policy is stated, not hidden:

- Contributions settle to the merchant **independently**. A completed leg is not rolled
  back when another fails. Aurora refunds a failed leg to the address that funded it.
- The invoice shows `partial` with verified credit and what is still due. The customer
  can pay the remainder later; the merchant decides whether to wait or refund the
  partial amount from their own wallet. Wono never moves merchant funds.
- On Solana, every source from one wallet is placed in **one transaction**, so those
  deposits land together or not at all (source-side atomicity; the routes still settle
  separately).

Revisit collection when the public-Intents transfer signing path is documented or
proven with a funded test account.

## Direct shares (2026-11-06)

A share paid in the invoice asset itself (native USDC on Solana) skips Aurora. The
customer's wallet transfers it straight to the merchant's USDC account, in the same
Solana transaction as any other Solana shares. This is still direct, per-contribution
settlement; it only removes a route that had nothing to swap or bridge.

- Why: measured live, an Aurora route from Solana USDC to Solana USDC cost about $0.25
  on a $3.44 share (≈7%). A direct transfer costs the Solana network fee, plus account rent
  if the merchant's USDC account does not exist yet (created idempotently, paid by the
  customer).
- Verification is unchanged: the share counts only when Wono finds the signature at
  finalized commitment with a net credit of the invoice mint to the invoice recipient,
  recorded once in `settlements` (`UNIQUE(chain, signature)`). A landed transaction
  without that credit becomes `unknown`, never paid.
- No provider status exists for these shares: `submitted` → `settled` (signature landed)
  → `verified` (finalized credit). Failed and expired signatures resolve as on the
  Aurora path.
- Covered by `apps/web/test/payments.test.ts` ("direct USDC"). Not yet exercised with a
  funded transfer.

## Route cost (measured 2026-11-06, live dry quotes)

| Route | 1 USDC | 5 USDC | 20 USDC | `withdrawFee` |
| --- | --- | --- | --- | --- |
| Base/Arbitrum USDC or SOL → Solana USDC | $0.24 (24%) | $0.26 (5%) | $0.34 (1.7%) | 0.237 USDC |
| SOL or Arbitrum USDC → Base USDC | $0.01 (0.8%) | $0.03 (0.6%) | $0.11 (0.5%) | 0.0024 USDC |

Aurora charges a flat ~0.237 USDC withdrawal fee on every route that delivers to Solana,
plus ~0.5% swap spread. Cost therefore scales with the number of routes, not the size of
each share. Decision (owner, 2026-11-06): keep Solana settlement; checkout auto-picks the
fewest routes (Solana USDC first, paid directly with no route), shows each route's fee in
dollars, and the total as a percentage. Paying into the merchant's NEAR Intents balance
(~0.5%, one withdrawal later) was considered and deferred because it changes what "paid"
means. Gasless EVM USDC (EIP-3009 relay) is deferred until after the hackathon.
