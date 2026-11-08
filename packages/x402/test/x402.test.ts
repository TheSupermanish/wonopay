import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePaymentResponse, encodePaymentHeader, findWonoRequirement, WonoError, type Invoice, type InvoiceContribution } from "@wono/sdk";
import { resourceTag, wonoFetch, wonoPaywall, type WonoFetchEvent } from "../src/index.ts";

const API = "https://api.test/report";
const WONO = "https://wono.test";
const MERCHANT = "Merchant1111111111111111111111111111111111";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL = "nep141:sol.omft.near";
const TAG = await resourceTag(API);
const USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_test1",
    merchantName: "Shop",
    description: "Report",
    reference: `${TAG}:abc`,
    amount: "1000000",
    decimals: 6,
    symbol: "USDC",
    destinationChain: "Solana",
    recipient: MERCHANT,
    state: "open",
    credited: "0",
    reserved: "0",
    remaining: "1000000",
    excess: "0",
    expiresAt: null,
    expired: false,
    createdAt: "2026-11-07T00:00:00.000Z",
    checkedAt: null,
    contributions: [],
    settlements: [],
    ...overrides,
  };
}

const PAID = invoice({ state: "paid", remaining: "0", credited: "1000000", settlements: [{ signature: "5igSig", amount: "1000000", url: "", slot: 1, verifiedAt: "" }] });

function fakeWono(current: () => Invoice | "missing") {
  const created: unknown[] = [];
  return {
    created,
    wono: {
      baseUrl: WONO,
      invoices: {
        create: async (input: unknown) => (created.push(input), invoice()),
        retrieve: async () => {
          const value = current();
          if (value === "missing") throw new WonoError("HTTP_ERROR", "Invoice not found.", { status: 404 });
          return value;
        },
      },
    } as never,
  };
}

const paidRequest = (id = "inv_test1") => new Request(API, { headers: { "x-payment": encodePaymentHeader(id) } });

describe("wonoPaywall", () => {
  it("answers 402 with a fresh invoice bound to the resource", async () => {
    const { wono, created } = fakeWono(() => invoice());
    const handler = wonoPaywall({ wono, price: "1.00", description: "Report" })(() => Response.json({ secret: true }));
    const response = await handler(new Request(API, { headers: { "x-forwarded-proto": "https", host: "api.test" } }));
    assert.equal(response.status, 402);
    const requirement = findWonoRequirement(await response.json());
    assert.equal(requirement?.extra.invoiceId, "inv_test1");
    assert.equal(requirement?.extra.wonoUrl, WONO);
    assert.equal(requirement?.resource, API);
    assert.match((created[0] as { reference: string }).reference, new RegExp(`^${TAG}:[0-9a-f]{16}$`));
  });

  it("refuses unknown, foreign, unpaid and garbage payments", async () => {
    const cases: [Invoice | "missing", string][] = [
      ["missing", "Unknown invoice."],
      [invoice({ state: "paid", reference: "x402:0000000000000000:abc" }), "That invoice is for a different resource."],
      [invoice({ state: "partial" }), "Invoice partial; not paid yet."],
    ];
    for (const [current, error] of cases) {
      const { wono } = fakeWono(() => current);
      const response = await wonoPaywall({ wono, price: "1" })(() => Response.json({ secret: true }))(paidRequest());
      assert.equal(response.status, 402);
      assert.equal(((await response.json()) as { error: string }).error, error);
    }
    const { wono } = fakeWono(() => PAID);
    const garbage = await wonoPaywall({ wono, price: "1" })(() => Response.json({}))(new Request(API, { headers: { "x-payment": "nope" } }));
    assert.equal(garbage.status, 402);
  });

  it("serves a paid invoice once, with X-PAYMENT-RESPONSE, and refuses a replay", async () => {
    const { wono } = fakeWono(() => PAID);
    let served = 0;
    const handler = wonoPaywall({ wono, price: "1" })((_request, { invoice }) => (served++, Response.json({ paidWith: invoice.id })));
    const ok = await handler(paidRequest());
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { paidWith: "inv_test1" });
    assert.equal(decodePaymentResponse(ok.headers.get("x-payment-response"))?.transaction, "5igSig");
    const replay = await handler(paidRequest());
    assert.equal(replay.status, 402);
    assert.equal(((await replay.json()) as { error: string }).error, "That invoice was already used.");
    assert.equal(served, 1);
  });

  it("releases the claim when the handler throws, so the payer can retry", async () => {
    const { wono } = fakeWono(() => PAID);
    let fail = true;
    const handler = wonoPaywall({ wono, price: "1" })(() => {
      if (fail) throw new Error("upstream down");
      return Response.json({ ok: true });
    });
    await assert.rejects(handler(paidRequest()), /upstream down/);
    fail = false;
    assert.equal((await handler(paidRequest())).status, 200);
  });
});

const contribution: InvoiceContribution = { id: "ctr_1", attemptId: "att_1", assetId: SOL, chain: "sol", chainName: "Solana", symbol: "SOL", decimals: 9, sourceAddress: PAYER, amountOut: "1000000", amountIn: "11500000", state: "quoted", depositAddress: "Dep1111" };

/** One fixture for the paid API and Wono's public pay API. */
function world(options: { balances?: Record<string, string>; api?: (request: Request) => Response; invoice?: Invoice; price?: string } = {}) {
  const calls: string[] = [];
  let paid = false;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.origin}${url.pathname}`);
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (url.origin === "https://api.test") {
      if (options.api) return options.api(request);
      if (request.headers.get("x-payment") === encodePaymentHeader("inv_test1") && paid) return json({ secret: true });
      return json({ x402Version: 1, error: "pay", accepts: [{ scheme: "wono-invoice", network: "solana", maxAmountRequired: options.price ?? "1000000", resource: API, description: "Report", mimeType: "application/json", payTo: MERCHANT, maxTimeoutSeconds: 3600, asset: "EPj", extra: { invoiceId: "inv_test1", checkoutUrl: `${WONO}/pay/inv_test1`, wonoUrl: WONO } }] }, 402);
    }
    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/pay/inv_test1":
        return json(options.invoice ?? invoice());
      case "GET /api/tokens":
        return json({ tokens: [
          { assetId: USDC, blockchain: "sol", symbol: "USDC", decimals: 6, chainName: "Solana", kind: "solana", chainId: null },
          { assetId: SOL, blockchain: "sol", symbol: "SOL", decimals: 9, chainName: "Solana", kind: "solana", chainId: null },
        ] });
      case "POST /api/balances":
        return json({ balances: Object.entries(options.balances ?? {}).map(([assetId, amount]) => ({ assetId, status: "ok", amount })) });
      case "POST /api/pay/inv_test1/quote": {
        const { parts } = (await request.json()) as { parts: { assetId: string }[] };
        const direct = parts[0]!.assetId === USDC;
        return json({ quotes: [{ assetId: parts[0]!.assetId, ok: true, quote: direct ? { amountIn: "1000000", amountOut: "1000000", direct: true } : { amountIn: "11400000", amountOut: "1000000" } }] });
      }
      case "POST /api/pay/inv_test1/attempts":
        return json({ attemptId: "att_1", status: "ready", error: null, invoice: invoice({ contributions: [contribution] }) });
      case "POST /api/pay/contributions/ctr_1/approval":
        return json({ kind: "solana", method: "signTransaction", transaction: "VU5TSUdORUQ=", lastValidBlockHeight: 1 });
      case "POST /api/pay/contributions/ctr_1/outcome":
        return json({ state: "submitted" });
      case "POST /api/pay/inv_test1/refresh":
        paid = true;
        return json(PAID);
    }
    return json({ error: "no route" }, 404);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("wonoFetch", () => {
  it("pays a 402 with SOL via Aurora, keeps a fee reserve, and retries once with X-PAYMENT", async () => {
    const { calls, fetch } = world({ balances: { [SOL]: "20000000" } });
    const events: WonoFetchEvent["type"][] = [];
    const signed: string[] = [];
    const pay = wonoFetch({ address: PAYER, sign: async (tx) => (signed.push(tx), "U0lHTkVE"), maxUsdc: "5", trustedWonoUrls: [WONO], fetch, pollMs: 1, onEvent: (event) => events.push(event.type) });
    const response = await pay(API);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { secret: true });
    assert.deepEqual(signed, ["VU5TSUdORUQ="]);
    assert.equal(calls.filter((call) => call === `GET ${API}`).length, 2);
    assert.deepEqual([...new Set(events)], ["requirement", "option", "chosen", "pay", "paid", "retry"]);
  });

  it("skips SOL when the balance cannot also cover the fee reserve", async () => {
    const { fetch } = world({ balances: { [SOL]: "12000000" } });
    await assert.rejects(
      wonoFetch({ address: PAYER, sign: async () => "", maxUsdc: "5", trustedWonoUrls: [WONO], fetch })(API),
      /cannot cover 1 USDC/,
    );
  });

  it("refuses a price above maxUsdc without quoting or signing", async () => {
    const { calls, fetch } = world({ balances: { [USDC]: "9000000" }, invoice: invoice({ amount: "6000000", remaining: "6000000" }), price: "6000000" });
    await assert.rejects(wonoFetch({ address: PAYER, sign: async () => assert.fail("signed"), maxUsdc: "5", trustedWonoUrls: [WONO], fetch })(API), /above this client's limit of 5 USDC/);
    assert.equal(calls.some((call) => call.endsWith("/quote")), false);
  });

  it("refuses a 402 whose price disagrees with the invoice Wono reports", async () => {
    const { fetch } = world({ balances: { [USDC]: "900000000" }, invoice: invoice({ amount: "500000000", remaining: "500000000" }) });
    await assert.rejects(wonoFetch({ address: PAYER, sign: async () => assert.fail("signed"), maxUsdc: "1000", trustedWonoUrls: [WONO], fetch })(API), (error: unknown) => error instanceof WonoError && error.code === "QUOTE_MISMATCH");
  });

  it("refuses to pay through a Wono it does not trust", async () => {
    const { fetch } = world({ balances: { [USDC]: "9000000" } });
    await assert.rejects(wonoFetch({ address: PAYER, sign: async () => assert.fail("signed"), maxUsdc: "5", fetch })(API), /not in trustedWonoUrls/);
  });

  it("dry run chooses a token and returns the 402 without reserving", async () => {
    const { calls, fetch } = world({ balances: { [USDC]: "9000000" } });
    let chosen = "";
    const response = await wonoFetch({ address: PAYER, sign: async () => assert.fail("signed"), maxUsdc: "5", trustedWonoUrls: [WONO], fetch, dryRun: true, onEvent: (event) => { if (event.type === "dry-run") chosen = event.option.token.symbol; } })(API);
    assert.equal(response.status, 402);
    assert.equal(chosen, "USDC");
    assert.equal(calls.some((call) => call.endsWith("/attempts")), false);
  });

  it("passes through non-402 and non-wono 402 responses untouched", async () => {
    const ok = world({ api: () => Response.json({ free: true }) });
    assert.equal((await wonoFetch({ address: PAYER, sign: async () => "", maxUsdc: "5", fetch: ok.fetch })(API)).status, 200);
    const exact = world({ api: () => Response.json({ x402Version: 1, accepts: [{ scheme: "exact" }] }, { status: 402 }) });
    const response = await wonoFetch({ address: PAYER, sign: async () => "", maxUsdc: "5", fetch: exact.fetch })(API);
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), { x402Version: 1, accepts: [{ scheme: "exact" }] });
    assert.equal(exact.calls.length, 1);
  });
});
