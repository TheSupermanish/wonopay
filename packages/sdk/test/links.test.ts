import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPayLink, getInvoice, isPaidTo, type Invoice } from "../src/index.ts";

const WALLET = "5bPgahZJ3xcKTG6VZf4knWye2mLtiEWZE2uZYBWaci17";

function recorder(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const invoice = (patch: Partial<Invoice>): Invoice =>
  ({ id: "inv_1", state: "paid", amount: "5000000", credited: "5000000", decimals: 6, recipient: WALLET, ...patch }) as Invoice;

describe("keyless links", () => {
  it("creates a link with no credentials", async () => {
    const { calls, fetch } = recorder(201, invoice({ state: "open", credited: "0" }));
    await createPayLink({ to: WALLET, amount: "5", name: "Manish" }, { baseUrl: "https://wono.test/", fetch });
    assert.equal(calls[0]!.url, "https://wono.test/api/v1/links");
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, undefined);
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { to: WALLET, amount: "5", name: "Manish" });
  });

  it("refreshes through the public reconcile endpoint", async () => {
    const { calls, fetch } = recorder(200, invoice({}));
    await getInvoice("inv/1", { baseUrl: "https://wono.test", refresh: true, fetch });
    assert.equal(calls[0]!.url, "https://wono.test/api/pay/inv%2F1/refresh");
    assert.equal(calls[0]!.init.method, "POST");
  });

  it("only counts a paid invoice to the expected wallet and amount", () => {
    assert.equal(isPaidTo(invoice({}), { to: WALLET, amount: "5" }), true);
    assert.equal(isPaidTo(invoice({ state: "partial" }), { to: WALLET, amount: "5" }), false);
    assert.equal(isPaidTo(invoice({ recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }), { to: WALLET, amount: "5" }), false);
    assert.equal(isPaidTo(invoice({ amount: "1000000", credited: "1000000" }), { to: WALLET, amount: "5" }), false);
  });
});
