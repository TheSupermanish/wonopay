import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodePaymentHeader,
  decodePaymentResponse,
  encodePaymentHeader,
  encodePaymentResponse,
  findWonoRequirement,
  paymentRequired,
  WonoError,
  WonoPay,
  type Invoice,
  type InvoiceContribution,
} from "../src/index.ts";

const SOL = "nep141:sol.omft.near";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_test1",
    merchantName: "Shop",
    description: "GET /api/report",
    reference: "x402:abc",
    amount: "1000000",
    decimals: 6,
    symbol: "USDC",
    destinationChain: "Solana",
    recipient: "Merchant1111111111111111111111111111111111",
    state: "open",
    credited: "0",
    reserved: "0",
    remaining: "1000000",
    excess: "0",
    expiresAt: null,
    expired: false,
    createdAt: "2026-11-06T00:00:00.000Z",
    checkedAt: null,
    contributions: [],
    settlements: [],
    ...overrides,
  };
}

const contribution: InvoiceContribution = { id: "ctr_1", attemptId: "att_1", assetId: SOL, chain: "sol", chainName: "Solana", symbol: "SOL", decimals: 9, sourceAddress: PAYER, amountOut: "1000000", amountIn: "11500000", state: "quoted", depositAddress: "Dep1111" };

/** Fixture server: records calls and answers from a script keyed by method + path. */
function fixture(routes: Record<string, (body: any, count: number) => unknown>) {
  const calls: { key: string; body: any }[] = [];
  const counts = new Map<string, number>();
  const fetch = (async (url: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ key, body });
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: `no route ${key}` }), { status: 404 });
    return new Response(JSON.stringify(handler(body, count)), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("WonoPay.payWithSolana", () => {
  it("quotes, reserves, signs once, submits, and waits for verification", async () => {
    const paid = invoice({ state: "paid", remaining: "0", credited: "1000000", contributions: [{ ...contribution, state: "verified" as const }], settlements: [{ signature: "SIG", amount: "1000000", url: "", slot: 1, verifiedAt: "" }] });
    const { calls, fetch } = fixture({
      "GET /api/pay/inv_test1": () => invoice(),
      "POST /api/pay/inv_test1/quote": () => ({ quotes: [{ assetId: SOL, ok: true, quote: { amountIn: "11400000", amountOut: "1000000" } }] }),
      "POST /api/pay/inv_test1/attempts": () => ({ attemptId: "att_1", status: "ready", error: null, invoice: invoice({ contributions: [contribution] }) }),
      "POST /api/pay/contributions/ctr_1/approval": () => ({ kind: "solana", method: "signTransaction", transaction: "VU5TSUdORUQ=", lastValidBlockHeight: 1 }),
      "POST /api/pay/contributions/ctr_1/outcome": () => ({ state: "submitted" }),
      "POST /api/pay/inv_test1/refresh": (_body, count) => (count < 2 ? invoice({ contributions: [{ ...contribution, state: "processing" as const }] }) : paid),
    });
    const signed: string[] = [];
    const result = await new WonoPay({ baseUrl: "https://wono.test", fetch }).payWithSolana({
      invoiceId: "inv_test1",
      assetId: SOL,
      address: PAYER,
      sign: async (tx) => { signed.push(tx); return "U0lHTkVE"; },
      pollMs: 1,
    });
    assert.equal(result.state, "paid");
    assert.deepEqual(signed, ["VU5TSUdORUQ="]);
    const attempt = calls.find((call) => call.key === "POST /api/pay/inv_test1/attempts")!;
    assert.deepEqual(attempt.body.parts, [{ assetId: SOL, amountOut: "1000000", sourceAddress: PAYER }]);
    assert.match(attempt.body.key, /^[A-Za-z0-9_-]{43}$/);
    const outcome = calls.find((call) => call.key === "POST /api/pay/contributions/ctr_1/outcome")!;
    assert.deepEqual(outcome.body.outcome, { type: "solana_signed", signedTransaction: "U0lHTkVE" });
    assert.equal(calls.filter((call) => call.key.endsWith("/outcome")).length, 1, "never resends");
  });

  it("declines without signing when the reserved route exceeds the payer's limit", async () => {
    const { calls, fetch } = fixture({
      "GET /api/pay/inv_test1": () => invoice(),
      "POST /api/pay/inv_test1/quote": () => ({ quotes: [{ assetId: SOL, ok: true, quote: { amountIn: "11400000", amountOut: "1000000" } }] }),
      "POST /api/pay/inv_test1/attempts": () => ({ attemptId: "att_1", status: "ready", error: null, invoice: invoice({ contributions: [contribution] }) }),
      "POST /api/pay/contributions/ctr_1/outcome": () => ({ state: "cancelled" }),
    });
    let asked = false;
    await assert.rejects(
      new WonoPay({ baseUrl: "https://wono.test", fetch }).payWithSolana({ invoiceId: "inv_test1", assetId: SOL, address: PAYER, maxAmountIn: "11000000", sign: async () => { asked = true; return ""; } }),
      (error: unknown) => error instanceof WonoError && error.code === "QUOTE_MISMATCH",
    );
    assert.equal(asked, false);
    assert.equal(calls.find((call) => call.key.endsWith("/outcome"))!.body.outcome.type, "declined");
    assert.equal(calls.some((call) => call.key.endsWith("/approval")), false);
  });

  it("reports a signing failure as declined (nothing was sent)", async () => {
    const { calls, fetch } = fixture({
      "GET /api/pay/inv_test1": () => invoice(),
      "POST /api/pay/inv_test1/quote": () => ({ quotes: [{ assetId: SOL, ok: true, quote: { amountIn: "1", amountOut: "1000000" } }] }),
      "POST /api/pay/inv_test1/attempts": () => ({ attemptId: "att_1", status: "ready", error: null, invoice: invoice({ contributions: [contribution] }) }),
      "POST /api/pay/contributions/ctr_1/approval": () => ({ kind: "solana", method: "signTransaction", transaction: "AA==", lastValidBlockHeight: 1 }),
      "POST /api/pay/contributions/ctr_1/outcome": () => ({ state: "cancelled" }),
    });
    await assert.rejects(new WonoPay({ baseUrl: "https://wono.test", fetch }).payWithSolana({ invoiceId: "inv_test1", assetId: SOL, address: PAYER, sign: async () => { throw new Error("key locked"); } }), /key locked/);
    assert.deepEqual(calls.find((call) => call.key.endsWith("/outcome"))!.body.outcome, { type: "declined", reason: "key locked" });
  });
});

describe("x402 with a Wono invoice", () => {
  it("builds a 402 body the client can find and pay", () => {
    const body = paymentRequired(invoice(), { resource: "http://shop.test/api/report", wonoUrl: "https://wono.test/" });
    assert.equal(body.x402Version, 1);
    const requirement = findWonoRequirement(JSON.parse(JSON.stringify(body)));
    assert.ok(requirement);
    assert.equal(requirement.maxAmountRequired, "1000000");
    assert.equal(requirement.asset, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    assert.equal(requirement.extra.invoiceId, "inv_test1");
    assert.equal(requirement.extra.checkoutUrl, "https://wono.test/pay/inv_test1");
    assert.equal(findWonoRequirement({ accepts: [{ scheme: "exact" }] }), undefined);
  });

  it("round-trips X-PAYMENT and rejects anything else", () => {
    assert.deepEqual(decodePaymentHeader(encodePaymentHeader("inv_test1")), { invoiceId: "inv_test1" });
    assert.equal(decodePaymentHeader("not base64 json"), undefined);
    assert.equal(decodePaymentHeader(btoa(JSON.stringify({ x402Version: 1, scheme: "exact", payload: { invoiceId: "inv_test1" } }))), undefined);
    assert.equal(decodePaymentHeader(btoa(JSON.stringify({ x402Version: 1, scheme: "wono-invoice", payload: { invoiceId: "../admin" } }))), undefined);
    assert.equal(decodePaymentHeader(undefined), undefined);
  });

  it("encodes X-PAYMENT-RESPONSE from the verified settlement", () => {
    const paid = invoice({ state: "paid", settlements: [{ signature: "5igSig", amount: "1000000", url: "", slot: 1, verifiedAt: "" }] });
    assert.deepEqual(decodePaymentResponse(encodePaymentResponse(paid)), { success: true, transaction: "5igSig", network: "solana", invoiceId: "inv_test1" });
  });
});
