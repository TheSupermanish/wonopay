# Wono

TypeScript npm-workspaces monorepo. `packages/sdk` (`@wono/sdk`) and `apps/web` (Next.js).
Use `.ts`/`.tsx` with ES modules. SDK sources import siblings with `.ts` extensions;
`tsc` rewrites them on build. Tests run on Node's native type stripping (`node --test`),
so keep syntax erasable (no enums, namespaces, or parameter properties).

- The SDK stays independent of React, Next.js, wallet vendors, databases, and keys.
- Amounts are canonical integer strings in token base units. Arithmetic uses bigint.
  Floats appear only in display estimates from provider prices.
- Bind provider responses to the requested asset, recipient, amount, refund address,
  deadline, and deposit route. Provider status is evidence, not payment.
- Paid means a finalized Solana credit of the invoice mint to the invoice recipient,
  verified by Wono and recorded once per signature. Iframe events and return URLs never
  establish payment.
- Unknown, partial, failed, refunded, cancelled, and expired stay distinct. Never resend
  automatically; uncertain amounts stay reserved.
- Persist every route before presenting it, and a transfer identifier before broadcast
  where the wallet allows it.
- Settlement policy is direct per contribution; see docs/settlement-architecture.md.
  Do not change it silently.
- Tests use injected HTTP fixtures. Live financial actions require the customer's wallet.

Read README.md for the public contract and current limits before changing behavior.
UI rules for the app live in apps/web/AGENTS.md.
