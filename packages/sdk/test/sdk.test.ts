import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyObservation,
  AuroraClient,
  bindQuote,
  buildQuoteRequest,
  decodeBase58,
  encodeBase58,
  encodeErc20Transfer,
  findSolanaUsdc,
  formatUnits,
  isSolanaAddress,
  parseTokenCatalog,
  readStatus,
  summarizeInvoice,
  toBaseUnits,
  verifySolanaTokenCredit,
  WonoError,
  type DepositQuote,
  type JsonRpc,
} from "../src/index.ts";
import { BASE_USDC, CUSTOMER_EVM, MERCHANT, quoteResponse, SOL_USDC, solanaTx, statusResponse, USDC_MINT } from "./fixtures.ts";

const KEY = "secret-key-value";
const deadline = () => new Date(Date.now() + 10 * 60_000).toISOString();
const route = (overrides = {}) => ({
  originAsset: BASE_USDC,
  destinationAsset: SOL_USDC,
  amountOut: "12000000",
  recipient: MERCHANT,
  refundTo: CUSTOMER_EVM,
  deadline: deadline(),
  slippageBps: 50,
  ...overrides,
});

function fakeFetch(handler: (url: URL, body: any) => unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify(handler(url, body)), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("amounts", () => {
  it("converts decimals without floating point", () => {
    assert.equal(toBaseUnits("20", 6), "20000000");
    assert.equal(toBaseUnits("0.000001", 6), "1");
    assert.equal(toBaseUnits("12.5", 18), "12500000000000000000");
    assert.throws(() => toBaseUnits("1.0000001", 6), WonoError);
    assert.throws(() => toBaseUnits("1e6", 6), WonoError);
    assert.throws(() => toBaseUnits("-1", 6), WonoError);
    assert.equal(formatUnits("12320040", 6), "12.32004");
    assert.equal(formatUnits("85982648", 9, 4), "0.0859");
  });
});

describe("addresses", () => {
  it("round-trips base58 and validates Solana addresses", () => {
    const bytes = decodeBase58(MERCHANT);
    assert.equal(bytes?.length, 32);
    assert.equal(encodeBase58(bytes!), MERCHANT);
    assert.equal(isSolanaAddress(USDC_MINT), true);
    assert.equal(isSolanaAddress("0OIl"), false);
    assert.equal(isSolanaAddress(CUSTOMER_EVM), false);
  });
  it("encodes ERC-20 transfer calldata", () => {
    assert.equal(
      encodeErc20Transfer("0x94F43faEDF2710598c880149aBb055f5d2CB9e0A", "12320040"),
      "0xa9059cbb00000000000000000000000094f43faedf2710598c880149abb055f5d2cb9e0a0000000000000000000000000000000000000000000000000000000000bbfd28",
    );
  });
});

describe("token catalog", () => {
  it("parses the live object shape and checks Solana USDC", () => {
    const tokens = parseTokenCatalog({
      asset_stats: [{ token_id: SOL_USDC, blockchain: "sol", symbol: "USDC", volume_amount_usd: "1" }],
      tokens: [{ assetId: SOL_USDC, decimals: 6, blockchain: "sol", symbol: "USDC", price: 0.9998, priceUpdatedAt: "2026-11-05T11:19:30.714Z", contractAddress: USDC_MINT }],
    });
    assert.equal(findSolanaUsdc(tokens).contractAddress, USDC_MINT);
    assert.throws(() => findSolanaUsdc([{ ...tokens[0]!, contractAddress: "Other" }]), WonoError);
    assert.throws(() => parseTokenCatalog({ tokens: [tokens[0], tokens[0]] }), WonoError);
  });
});

describe("quote binding", () => {
  it("accepts a live-shaped deposit quote whose refund deadline is days later", () => {
    const request = buildQuoteRequest(route(), false);
    const quote = bindQuote(quoteResponse(request), request);
    assert.equal(quote.depositAddress, "0x94F43faEDF2710598c880149aBb055f5d2CB9e0A");
    assert.equal(quote.amountIn, "12320040");
    assert.equal(quote.withdrawFee, "256213");
  });

  it("rejects a quote echo for another recipient, refund address, amount, or asset", () => {
    const request = buildQuoteRequest(route(), false);
    for (const change of [{ recipient: "Attacker1111111111111111111111111111111111" }, { refundTo: "0x0000000000000000000000000000000000000001" }, { amount: "1" }, { originAsset: SOL_USDC }]) {
      const response = quoteResponse(request);
      Object.assign(response.quoteRequest, change);
      assert.throws(() => bindQuote(response, request), (error: WonoError) => error.code === "QUOTE_MISMATCH");
    }
  });

  it("rejects quotes that permit a shortfall or are already expired", () => {
    const request = buildQuoteRequest(route(), false);
    assert.throws(() => bindQuote(quoteResponse(request, { minAmountOut: "11999999" }), request), WonoError);
    assert.throws(() => bindQuote(quoteResponse(request, { deadline: new Date(Date.now() - 1000).toISOString() }), request), WonoError);
    assert.throws(() => bindQuote(quoteResponse(request, { depositAddress: undefined }), request), WonoError);
  });

  it("never leaks the API key from network or HTTP errors", async () => {
    const failing = new AuroraClient({ apiKey: KEY, fetch: (async () => { throw new Error(`fetch failed https://x/${KEY}`); }) as typeof fetch });
    await assert.rejects(failing.getTokens(), (error: Error) => !error.message.includes(KEY));
    const rejecting = new AuroraClient({ apiKey: KEY, fetch: fakeFetch(() => ({ message: `bad key ${KEY}` }), 400) });
    await assert.rejects(rejecting.dryQuote(route()), (error: WonoError) => error.code === "HTTP_ERROR" && !error.message.includes(KEY) && error.status === 400);
  });

  it("sends the exact request and puts the key in the path", async () => {
    let seen: URL | undefined;
    let sent: any;
    const client = new AuroraClient({ apiKey: KEY, fetch: fakeFetch((url, body) => { seen = url; sent = body; return quoteResponse(body); }) });
    const quote = await client.depositQuote(route());
    assert.equal(seen?.pathname, `/api/quote/${KEY}`);
    assert.equal(sent.swapType, "EXACT_OUTPUT");
    assert.equal(sent.recipientType, "DESTINATION_CHAIN");
    assert.equal(sent.refundType, "ORIGIN_CHAIN");
    assert.equal(quote.request.amount, "12000000");
  });
});

describe("provider status", () => {
  const request = buildQuoteRequest(route(), false);
  const raw = quoteResponse(request);
  const saved = bindQuote(raw, request) as DepositQuote;

  it("binds status to the saved quote and extracts evidence", () => {
    const observation = readStatus(statusResponse(raw, "SUCCESS", {
      amountOut: "12000000",
      destinationChainTxHashes: [{ hash: "5sig", explorerUrl: "" }],
      originChainTxHashes: [{ hash: "0xabc", explorerUrl: "" }],
    }), saved);
    assert.equal(observation.status, "SUCCESS");
    assert.deepEqual(observation.destinationTxHashes, ["5sig"]);
    assert.equal(applyObservation("submitted", observation), "settled");
  });

  it("treats a status for another quote or route as a mismatch", () => {
    const other = statusResponse(raw, "SUCCESS");
    other.quoteResponse = { ...other.quoteResponse, signature: "ed25519:other" };
    assert.throws(() => readStatus(other, saved), (error: WonoError) => error.code === "QUOTE_MISMATCH");
    const moved = statusResponse(raw, "SUCCESS");
    moved.quoteResponse = { ...moved.quoteResponse, quote: { ...moved.quoteResponse.quote, depositAddress: "0x0000000000000000000000000000000000000002" } };
    assert.throws(() => readStatus(moved, saved), (error: WonoError) => error.code === "QUOTE_MISMATCH");
  });

  it("keeps pending, refund, failure, and conflicting outcomes distinct", () => {
    const at = (status: string) => readStatus(statusResponse(raw, status), saved);
    assert.equal(applyObservation("awaiting_approval", at("PENDING_DEPOSIT")), "awaiting_approval");
    assert.equal(applyObservation("awaiting_approval", at("KNOWN_DEPOSIT_TX")), "processing");
    assert.equal(applyObservation("submitted", at("INCOMPLETE_DEPOSIT")), "processing");
    assert.equal(applyObservation("processing", at("REFUNDED")), "refunded");
    assert.equal(applyObservation("processing", at("FAILED")), "failed");
    assert.equal(applyObservation("verified", at("REFUNDED")), "unknown");
    assert.equal(applyObservation("expired", at("PROCESSING")), "unknown");
  });
});

describe("invoice summary", () => {
  it("separates verified credit, reserved in-flight output, and remaining", () => {
    const parts = [
      { state: "verified" as const, amountOut: "12000000" },
      { state: "failed" as const, amountOut: "8000000" },
    ];
    const partial = summarizeInvoice("20000000", parts, "12000000");
    assert.deepEqual(partial, { state: "partial", credited: "12000000", reserved: "0", remaining: "8000000", excess: "0" });

    const uncertain = summarizeInvoice("20000000", [...parts, { state: "unknown", amountOut: "8000000" }], "12000000");
    assert.equal(uncertain.state, "unknown");
    assert.equal(uncertain.remaining, "0", "uncertain output must not be offered again");

    const paid = summarizeInvoice("20000000", [...parts, { state: "verified", amountOut: "8000000" }], "20000001");
    assert.equal(paid.state, "paid");
    assert.equal(paid.excess, "1");

    assert.equal(summarizeInvoice("20000000", [], "0").state, "open");
    assert.equal(summarizeInvoice("20000000", [{ state: "refunded", amountOut: "20000000" }], "0").state, "refunded");
  });
});

describe("Solana settlement verification", () => {
  const rpc = (result: unknown): JsonRpc => ({ call: async () => result as never });
  const input = { signature: "5sig", mint: USDC_MINT, owner: MERCHANT };

  it("verifies the net credit to the merchant owner and mint", async () => {
    assert.deepEqual(await verifySolanaTokenCredit(rpc(solanaTx({ pre: "1000000", post: "13000000" })), input), {
      status: "verified", amount: "12000000", slot: 380000000, blockTime: 1793000000,
    });
    // A newly created token account has no pre-balance.
    assert.equal((await verifySolanaTokenCredit(rpc(solanaTx({})), input)).status, "verified");
  });

  it("rejects failed transactions, wrong mints, and wrong owners", async () => {
    assert.equal((await verifySolanaTokenCredit(rpc(solanaTx({ err: { InstructionError: [0, "Custom"] } })), input)).status, "rejected");
    assert.equal((await verifySolanaTokenCredit(rpc(solanaTx({ mint: "So11111111111111111111111111111111111111112" })), input)).status, "rejected");
    assert.equal((await verifySolanaTokenCredit(rpc(solanaTx({ owner: CUSTOMER_EVM })), input)).status, "rejected");
  });

  it("waits for finality instead of guessing", async () => {
    assert.equal((await verifySolanaTokenCredit(rpc(null), input)).status, "pending");
  });
});
