import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Wono, WonoError } from "../src/index.ts";

const invoice = { id: "inv_1", state: "open", amount: "25000000", decimals: 6, checkoutUrl: "https://wono.test/pay/inv_1" };

function recorder(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("Wono merchant client", () => {
  it("creates an invoice with the secret key as a bearer token", async () => {
    const { calls, fetch } = recorder(201, invoice);
    const wono = new Wono({ apiKey: "wono_sk_test", baseUrl: "https://wono.test/", fetch });
    const created = await wono.invoices.create({ amount: "25", reference: "order-1" });
    assert.equal(created.id, "inv_1");
    assert.equal(calls[0]!.url, "https://wono.test/api/v1/invoices");
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "Bearer wono_sk_test");
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { amount: "25", reference: "order-1" });
  });

  it("retrieves with refresh and encodes the id", async () => {
    const { calls, fetch } = recorder(200, invoice);
    await new Wono({ apiKey: "wono_sk_test", baseUrl: "https://wono.test", fetch }).invoices.retrieve("inv/1", { refresh: true });
    assert.equal(calls[0]!.url, "https://wono.test/api/v1/invoices/inv%2F1?refresh=1");
  });

  it("surfaces API errors with status and message", async () => {
    const { fetch } = recorder(409, { error: "Reference already used." });
    const wono = new Wono({ apiKey: "wono_sk_test", fetch });
    await assert.rejects(wono.invoices.create({ amount: "1", reference: "dup" }), (error: unknown) =>
      error instanceof WonoError && error.code === "HTTP_ERROR" && error.status === 409 && error.message === "Reference already used.");
  });

  it("rejects malformed responses and keys", async () => {
    const { fetch } = recorder(200, { ok: true });
    await assert.rejects(new Wono({ apiKey: "wono_sk_test", fetch }).invoices.retrieve("inv_1"), (error: unknown) => error instanceof WonoError && error.code === "INVALID_RESPONSE");
    assert.throws(() => new Wono({ apiKey: "pk_live_nope" }), WonoError);
  });

  it("builds the hosted checkout URL", () => {
    assert.equal(new Wono({ apiKey: "wono_sk_test", baseUrl: "https://wono.test" }).checkoutUrl("inv_1"), "https://wono.test/pay/inv_1");
  });
});
