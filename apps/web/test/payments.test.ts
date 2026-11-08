// Server payment flow against injected HTTP fixtures (Aurora + chain RPC). No network.
// Run: node --conditions=react-server --test test/*.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ComputeBudgetProgram, Keypair, Transaction } from "@solana/web3.js";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.WONO_AURORA_API_KEY = "test-key";

const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "nep141:sol.omft.near";
const BONK = "nep141:sol-bonk.omft.near";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const MERCHANT = Keypair.generate().publicKey.toBase58();
const CUSTOMER_SOL = Keypair.generate();
const CUSTOMER_EVM = "0xae711a0bcdb064a7aefcd772282f50df639bdd6f";

// ---- fixture network ------------------------------------------------------
const quotes = new Map<string, any>(); // depositAddress -> quote response
const statuses = new Map<string, { status: string; swapDetails?: any }>();
const solanaTxs = new Map<string, any>(); // signature -> getTransaction result
const landed = new Set<string>(); // signatures reported finalized by getSignatureStatuses
const sent: string[] = [];
let blockHeight = 1000;
let sponsorLamports = 1_000_000_000;
let depositCounter = 0;

function quoteFor(request: any) {
  const evm = request.originAsset === BASE_USDC;
  const depositAddress = evm ? `0x${(++depositCounter).toString(16).padStart(40, "0")}` : Keypair.generate().publicKey.toBase58();
  const response = {
    timestamp: new Date().toISOString(),
    signature: `ed25519:sig${depositCounter}${Math.random()}`,
    correlationId: "c",
    quoteRequest: { ...request, referral: "aurora", appFees: [] },
    quote: {
      amountIn: (BigInt(request.amount) * 103n / 100n).toString(),
      minAmountIn: request.amount,
      amountOut: request.amount,
      minAmountOut: request.amount,
      amountInUsd: "1.03",
      amountOutUsd: "1.00",
      timeEstimate: 20,
      ...(request.dry ? {} : {
        depositAddress,
        deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        timeWhenInactive: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      }),
    },
  };
  if (!request.dry) {
    quotes.set(depositAddress, response);
    statuses.set(depositAddress, { status: "PENDING_DEPOSIT" });
  }
  return response;
}

function rpcResult(method: string, params: any[]): unknown {
  switch (method) {
    case "getLatestBlockhash":
      return { value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: blockHeight + 150 } };
    case "getAccountInfo":
      return { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" } };
    case "getBlockHeight":
      return blockHeight;
    case "getBalance":
      return { value: sponsorLamports };
    case "sendTransaction":
      sent.push(params[0]);
      return "ok";
    case "getSignatureStatuses":
      return { value: [landed.has(params[0][0]) ? { slot: 42, err: null, confirmationStatus: "finalized" } : null] };
    case "getTransaction":
      return solanaTxs.get(params[0]) ?? null;
    case "eth_getTransactionReceipt":
      return { status: "0x1" };
    default:
      throw new Error(`unexpected rpc ${method}`);
  }
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "intents-api.aurora.dev") {
    if (url.pathname.startsWith("/api/tokens/")) {
      return reply({
        asset_stats: [],
        tokens: [
          { assetId: SOL_USDC, blockchain: "sol", symbol: "USDC", decimals: 6, contractAddress: USDC_MINT, price: 1 },
          { assetId: SOL, blockchain: "sol", symbol: "SOL", decimals: 9, price: 100 },
          { assetId: BONK, blockchain: "sol", symbol: "BONK", decimals: 5, contractAddress: BONK_MINT, price: 0.00002 },
          { assetId: BASE_USDC, blockchain: "base", symbol: "USDC", decimals: 6, contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", price: 1 },
        ],
      });
    }
    if (url.pathname.startsWith("/api/quote/")) return reply(quoteFor(body));
    if (url.pathname.startsWith("/api/deposit/submit/")) return reply({});
    if (url.pathname.startsWith("/api/status/")) {
      const address = url.searchParams.get("depositAddress")!;
      const state = statuses.get(address);
      if (!state) return reply({ message: "not found" }, 404);
      return reply({ status: state.status, quoteResponse: quotes.get(address), updatedAt: new Date().toISOString(), swapDetails: state.swapDetails ?? {} });
    }
  }
  if (body?.jsonrpc) return reply({ jsonrpc: "2.0", id: body.id, result: rpcResult(body.method, body.params) });
  throw new Error(`unexpected fetch ${url.href}`);
}) as typeof fetch;

function settlementTx(amount: string, owner = MERCHANT) {
  return {
    slot: 42,
    blockTime: 1,
    meta: {
      err: null,
      preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 1, mint: USDC_MINT, owner, uiTokenAmount: { amount } }],
    },
  };
}

// ---- system under test ------------------------------------------------------
let payments: typeof import("../lib/server/payments.ts");
let invoices: typeof import("../lib/server/invoices.ts");
let database: typeof import("../lib/server/db.ts");
let merchantId: string;
let replSet: MongoMemoryReplSet;

before(async () => {
  // MONGODB_URI must exist before the server modules are imported: db.ts reads it lazily
  // on first connect, but setting it up front keeps this test independent of that detail.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri();

  database = await import("../lib/server/db.ts");
  invoices = await import("../lib/server/invoices.ts");
  payments = await import("../lib/server/payments.ts");
  const time = new Date().toISOString();
  await (await database.col("users")).insertOne({ id: "u1", email: "m@x.io", password_hash: "x", created_at: time });
  merchantId = "mer_1";
  await (await database.col("merchants")).insertOne({
    id: merchantId,
    user_id: "u1",
    store_name: "Orbit",
    settlement_address: MERCHANT,
    allowed_origins: "[]",
    api_key_hash: null,
    api_key_hint: null,
    logo: null,
    logo_updated_at: null,
    created_at: time,
    updated_at: time,
  });
});

after(async () => {
  await database.closeDatabase();
  await replSet.stop();
});

beforeEach(() => {
  sent.length = 0;
  blockHeight = 1000;
});

const KEY = "k".repeat(40);
const merchant = () => ({ id: merchantId, userId: "u1", email: "m@x.io", storeName: "Orbit", settlementAddress: MERCHANT, allowedOrigins: [], apiKeyHint: null, logo: null });
const newInvoice = (amount = "20") => invoices.createInvoice(merchant(), { amount });
const parts = (invoiceId: string) => invoices.contributionsFor(invoiceId);

function succeed(depositAddress: string, signature: string, amount: string) {
  statuses.set(depositAddress, { status: "SUCCESS", swapDetails: { amountOut: amount, destinationChainTxHashes: [{ hash: signature }] } });
  solanaTxs.set(signature, settlementTx(amount));
}

describe("payment attempts", () => {
  it("rejects allocations that do not cover exactly the remaining amount", async () => {
    const invoice = await newInvoice();
    await assert.rejects(
      payments.createAttempt(invoice.id, KEY, [{ assetId: BASE_USDC, amountOut: "19000000", sourceAddress: CUSTOMER_EVM }]),
      /exactly the remaining/,
    );
  });

  it("prices partial allocations for display but never more than is owed", async () => {
    const invoice = await newInvoice();
    const [quote] = await payments.dryQuotes(invoice.id, [{ assetId: BASE_USDC, amountOut: "5000000", sourceAddress: CUSTOMER_EVM }]);
    assert.equal(quote?.ok, true);
    await assert.rejects(
      payments.dryQuotes(invoice.id, [{ assetId: BASE_USDC, amountOut: "21000000", sourceAddress: CUSTOMER_EVM }]),
      /exceed the remaining/,
    );
  });

  it("persists routes, is idempotent per key, and hands each route to a wallet once", async () => {
    const invoice = await newInvoice();
    const input = [{ assetId: BASE_USDC, amountOut: "20000000", sourceAddress: CUSTOMER_EVM }];
    const first = await payments.createAttempt(invoice.id, KEY, input);
    const again = await payments.createAttempt(invoice.id, KEY, input);
    assert.equal(first.status, "ready");
    assert.equal(again.attemptId, first.attemptId);
    const [part] = (await parts(invoice.id));
    assert.equal(part!.state, "quoted");
    assert.ok(part!.deposit_address);

    await assert.rejects(payments.requestApproval([part!.id], "wrong-key-wrong-key-wrong-key-wrong", CUSTOMER_EVM, "eth_sendTransaction"), /another browser/);
    await assert.rejects(payments.requestApproval([part!.id], KEY, "0x0000000000000000000000000000000000000009", "eth_sendTransaction"), /wallet this payment/);

    const results = await Promise.allSettled([
      payments.requestApproval([part!.id], KEY, CUSTOMER_EVM, "eth_sendTransaction"),
      payments.requestApproval([part!.id], KEY, CUSTOMER_EVM, "eth_sendTransaction"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "only one wallet prompt per route");
    const request = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<any>).value;
    assert.equal(request.kind, "evm");
    assert.equal(request.chainId, 8453);
    assert.equal(request.transaction.to, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    assert.match(request.transaction.data, /^0xa9059cbb/);
    assert.equal((await invoices.recomputeInvoice(invoice.id)).state, "awaiting_approval");
  });

  it("verifies settlement on Solana before marking paid, and never credits one transaction twice", async () => {
    const invoice = await newInvoice();
    await payments.createAttempt(invoice.id, `${KEY}a`, [{ assetId: BASE_USDC, amountOut: "20000000", sourceAddress: CUSTOMER_EVM }]);
    const [part] = (await parts(invoice.id));
    await payments.requestApproval([part!.id], `${KEY}a`, CUSTOMER_EVM, "eth_sendTransaction");
    await payments.reportOutcome([part!.id], `${KEY}a`, { type: "sent", txHash: `0x${"ab".repeat(32)}` });
    assert.equal((await payments.reconcileInvoice(invoice.id)).state, "submitted");

    // Provider success alone is not payment: finality not reached yet.
    statuses.set(part!.deposit_address!, { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "SettleSig1" }] } });
    assert.equal((await payments.reconcileInvoice(invoice.id)).state, "processing");
    assert.equal((await parts(invoice.id))[0]!.state, "settled");

    solanaTxs.set("SettleSig1", settlementTx("20000000"));
    const paid = await payments.reconcileInvoice(invoice.id);
    assert.equal(paid.state, "paid");
    assert.equal(paid.credited, "20000000");
    assert.equal((await payments.reconcileInvoice(invoice.id)).credited, "20000000", "re-reconciling does not double count");

    // Another invoice whose provider points at the same settlement transaction.
    const other = await newInvoice();
    await payments.createAttempt(other.id, `${KEY}b`, [{ assetId: BASE_USDC, amountOut: "20000000", sourceAddress: CUSTOMER_EVM }]);
    const [otherPart] = (await parts(other.id));
    await payments.requestApproval([otherPart!.id], `${KEY}b`, CUSTOMER_EVM, "eth_sendTransaction");
    await payments.reportOutcome([otherPart!.id], `${KEY}b`, { type: "sent", txHash: `0x${"cd".repeat(32)}` });
    statuses.set(otherPart!.deposit_address!, { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "SettleSig1" }] } });
    const reused = await payments.reconcileInvoice(other.id);
    assert.equal(reused.state, "unknown");
    assert.equal(reused.credited, "0");
  });

  it("rejects provider success that the chain does not confirm", async () => {
    const invoice = await newInvoice();
    await payments.createAttempt(invoice.id, `${KEY}c`, [{ assetId: BASE_USDC, amountOut: "20000000", sourceAddress: CUSTOMER_EVM }]);
    const [part] = (await parts(invoice.id));
    await payments.requestApproval([part!.id], `${KEY}c`, CUSTOMER_EVM, "eth_sendTransaction");
    await payments.reportOutcome([part!.id], `${KEY}c`, { type: "sent", txHash: `0x${"ef".repeat(32)}` });
    statuses.set(part!.deposit_address!, { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "WrongOwnerSig" }] } });
    solanaTxs.set("WrongOwnerSig", settlementTx("20000000", Keypair.generate().publicKey.toBase58()));
    const result = await payments.reconcileInvoice(invoice.id);
    assert.equal(result.state, "unknown");
    assert.equal(result.credited, "0");
  });

  it("keeps uncertain transfers reserved and lets the customer pay only the rest", async () => {
    const invoice = await newInvoice();
    await payments.createAttempt(invoice.id, `${KEY}d`, [
      { assetId: BASE_USDC, amountOut: "12000000", sourceAddress: CUSTOMER_EVM },
      { assetId: SOL, amountOut: "8000000", sourceAddress: CUSTOMER_SOL.publicKey.toBase58() },
    ]);
    const base = (await parts(invoice.id)).find((part) => part.chain === "base")!;
    const sol = (await parts(invoice.id)).find((part) => part.chain === "sol")!;
    await payments.requestApproval([base.id], `${KEY}d`, CUSTOMER_EVM, "eth_sendTransaction");
    await payments.reportOutcome([base.id], `${KEY}d`, { type: "uncertain", reason: "RPC timeout" });
    succeed(sol.deposit_address!, "SolSettle", "8000000");
    // The SOL leg was never approved, so its success would be a surprise deposit; mark it sent first.
    await payments.requestApproval([sol.id], `${KEY}d`, CUSTOMER_SOL.publicKey.toBase58(), "signAndSendTransaction");
    await payments.reportOutcome([sol.id], `${KEY}d`, { type: "sent", txHash: "5".repeat(88) });
    const result = await payments.reconcileInvoice(invoice.id);
    const view = await invoices.invoiceView(result, "Orbit");
    assert.equal(result.state, "unknown");
    assert.equal(view.credited, "8000000");
    assert.equal(view.reserved, "12000000");
    assert.equal(view.remaining, "0", "uncertain 12 USDC is not offered again");
    await assert.rejects(
      payments.createAttempt(invoice.id, `${KEY}e`, [{ assetId: BASE_USDC, amountOut: "12000000", sourceAddress: CUSTOMER_EVM }]),
      /exactly the remaining/,
    );
  });

  it("reports partial payment when one leg is refunded, and allows topping up the remainder", async () => {
    const invoice = await newInvoice();
    await payments.createAttempt(invoice.id, `${KEY}f`, [
      { assetId: BASE_USDC, amountOut: "12000000", sourceAddress: CUSTOMER_EVM },
      { assetId: SOL, amountOut: "8000000", sourceAddress: CUSTOMER_SOL.publicKey.toBase58() },
    ]);
    const base = (await parts(invoice.id)).find((part) => part.chain === "base")!;
    const sol = (await parts(invoice.id)).find((part) => part.chain === "sol")!;
    await payments.requestApproval([base.id], `${KEY}f`, CUSTOMER_EVM, "eth_sendTransaction");
    await payments.reportOutcome([base.id], `${KEY}f`, { type: "sent", txHash: `0x${"12".repeat(32)}` });
    await payments.requestApproval([sol.id], `${KEY}f`, CUSTOMER_SOL.publicKey.toBase58(), "signAndSendTransaction");
    await payments.reportOutcome([sol.id], `${KEY}f`, { type: "sent", txHash: "6".repeat(88) });
    succeed(base.deposit_address!, "BaseSettle", "12000000");
    statuses.set(sol.deposit_address!, { status: "REFUNDED", swapDetails: { refundedAmount: "8240000", refundReason: "slippage" } });
    const result = await payments.reconcileInvoice(invoice.id);
    const view = await invoices.invoiceView(result, "Orbit");
    assert.equal(result.state, "partial");
    assert.equal(view.remaining, "8000000");
    const topUp = await payments.createAttempt(invoice.id, `${KEY}g`, [{ assetId: BASE_USDC, amountOut: "8000000", sourceAddress: CUSTOMER_EVM }]);
    assert.equal(topUp.status, "ready");
  });

  it("returns a declined route to quoted without sending anything", async () => {
    const invoice = await newInvoice();
    await payments.createAttempt(invoice.id, `${KEY}h`, [{ assetId: BASE_USDC, amountOut: "20000000", sourceAddress: CUSTOMER_EVM }]);
    const [part] = (await parts(invoice.id));
    await payments.requestApproval([part!.id], `${KEY}h`, CUSTOMER_EVM, "eth_sendTransaction");
    assert.equal(await payments.reportOutcome([part!.id], `${KEY}h`, { type: "declined", reason: "Declined in wallet." }), "quoted");
    // After the approval window, the route expires and keeps saying the wallet declined it.
    await (await database.col("attempts")).updateOne({ id: part!.attempt_id }, { $set: { approve_before: new Date(Date.now() - 1000).toISOString() } });
    await payments.reconcileInvoice(invoice.id);
    const [expired] = (await parts(invoice.id));
    assert.equal(expired!.state, "expired");
    assert.equal(expired!.detail, "Declined in wallet; approval window closed. Nothing was sent.");
  });
});

describe("Solana batch", () => {
  it("puts every Solana source in one signed transaction and broadcasts it only after persisting", async () => {
    const invoice = await newInvoice();
    const payer = CUSTOMER_SOL.publicKey.toBase58();
    await payments.createAttempt(invoice.id, `${KEY}s`, [
      { assetId: SOL, amountOut: "5000000", sourceAddress: payer },
      { assetId: BONK, amountOut: "7000000", sourceAddress: payer },
      { assetId: SOL_USDC, amountOut: "8000000", sourceAddress: payer },
    ]);
    const ids = (await parts(invoice.id)).map((part) => part.id);
    const request = (await payments.requestApproval(ids, `${KEY}s`, payer, "signTransaction")) as any;
    assert.equal(request.kind, "solana");
    const tx = Transaction.from(Buffer.from(request.transaction, "base64"));
    assert.equal(tx.instructions.length, 5, "1 SOL transfer + 2 × (create ATA + transferChecked)");
    assert.ok((await parts(invoice.id)).every((part) => part.state === "awaiting_approval"));

    tx.sign(CUSTOMER_SOL);
    await payments.reportOutcome(ids, `${KEY}s`, { type: "solana_signed", signedTransaction: tx.serialize().toString("base64") });
    const after = (await parts(invoice.id));
    assert.ok(after.every((part) => part.state === "submitted" && part.tx_hash === after[0]!.tx_hash && part.signed_tx));
    assert.equal(sent.length, 1);

    // A tampered transaction (extra transfer) is refused and never broadcast.
    const second = await newInvoice();
    await payments.createAttempt(second.id, `${KEY}t`, [{ assetId: SOL, amountOut: "20000000", sourceAddress: payer }]);
    const [only] = (await parts(second.id));
    const prepared = (await payments.requestApproval([only!.id], `${KEY}t`, payer, "signTransaction")) as any;
    const tampered = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    tampered.add(...Transaction.from(Buffer.from(request.transaction, "base64")).instructions.slice(0, 1));
    tampered.sign(CUSTOMER_SOL);
    await payments.reportOutcome([only!.id], `${KEY}t`, { type: "solana_signed", signedTransaction: tampered.serialize().toString("base64") });
    assert.equal((await parts(second.id))[0]!.state, "unknown");
    assert.equal(sent.length, 1);

    // Once its blockhash can no longer land and nothing is on-chain, it resolves to expired (not sent).
    blockHeight = 5000;
    await payments.reconcileInvoice(second.id);
    assert.equal((await parts(second.id))[0]!.state, "expired");
    assert.equal((await invoices.invoiceView((await invoices.invoiceRow(second.id))!, "Orbit")).remaining, "20000000");
  });
});

describe("direct USDC", () => {
  it("pays a Solana USDC share straight to the merchant without an Aurora route, and verifies it on-chain", async () => {
    const invoice = await newInvoice("5");
    const payer = CUSTOMER_SOL.publicKey.toBase58();
    const routesBefore = quotes.size;

    const [preview] = await payments.dryQuotes(invoice.id, [{ assetId: SOL_USDC, amountOut: "5000000", sourceAddress: payer }]);
    assert.ok(preview?.ok && preview.quote.direct && preview.quote.amountIn === "5000000", "no route fee on a direct share");

    await payments.createAttempt(invoice.id, `${KEY}d`, [{ assetId: SOL_USDC, amountOut: "5000000", sourceAddress: payer }]);
    const [part] = (await parts(invoice.id));
    assert.equal(quotes.size, routesBefore, "no Aurora deposit route was requested");
    assert.equal(part!.deposit_address, null);
    assert.equal(part!.amount_in, "5000000");

    const request = (await payments.requestApproval([part!.id], `${KEY}d`, payer, "signTransaction")) as any;
    const tx = Transaction.from(Buffer.from(request.transaction, "base64"));
    assert.equal(tx.instructions.length, 2, "create merchant ATA (idempotent) + transferChecked");
    tx.sign(CUSTOMER_SOL);
    await payments.reportOutcome([part!.id], `${KEY}d`, { type: "solana_signed", signedTransaction: tx.serialize().toString("base64") });
    const signature = (await parts(invoice.id))[0]!.tx_hash!;

    // Not landed yet: stays submitted, nothing credited.
    await payments.reconcileInvoice(invoice.id);
    assert.equal((await parts(invoice.id))[0]!.state, "submitted");

    // Landed and finalized with the merchant's USDC credit: verified and paid, credited once.
    landed.add(signature);
    solanaTxs.set(signature, settlementTx("5000000"));
    await payments.reconcileInvoice(invoice.id);
    await payments.reconcileInvoice(invoice.id);
    assert.equal((await parts(invoice.id))[0]!.state, "verified");
    const view = await invoices.invoiceView((await invoices.invoiceRow(invoice.id))!, "Orbit");
    assert.equal(view.state, "paid");
    assert.equal(view.credited, "5000000");
  });

  it("does not mark a direct share paid when the landed transaction did not credit the merchant", async () => {
    const invoice = await newInvoice("3");
    const payer = CUSTOMER_SOL.publicKey.toBase58();
    await payments.createAttempt(invoice.id, `${KEY}x`, [{ assetId: SOL_USDC, amountOut: "3000000", sourceAddress: payer }]);
    const [part] = (await parts(invoice.id));
    const request = (await payments.requestApproval([part!.id], `${KEY}x`, payer, "signTransaction")) as any;
    const tx = Transaction.from(Buffer.from(request.transaction, "base64"));
    tx.sign(CUSTOMER_SOL);
    await payments.reportOutcome([part!.id], `${KEY}x`, { type: "solana_signed", signedTransaction: tx.serialize().toString("base64") });
    const signature = (await parts(invoice.id))[0]!.tx_hash!;
    landed.add(signature);
    solanaTxs.set(signature, settlementTx("3000000", Keypair.generate().publicKey.toBase58()));
    await payments.reconcileInvoice(invoice.id);
    assert.equal((await parts(invoice.id))[0]!.state, "unknown");
    assert.equal((await invoices.invoiceView((await invoices.invoiceRow(invoice.id))!, "Orbit")).credited, "0");
  });
});

describe("sponsored Solana fees", () => {
  const SPONSOR = Keypair.generate();
  const reset = () => { (globalThis as { __wonoSponsor?: unknown }).__wonoSponsor = undefined; };
  before(() => { process.env.WONO_SOLANA_FEE_PAYER_SECRET = JSON.stringify([...SPONSOR.secretKey]); reset(); });
  after(() => { delete process.env.WONO_SOLANA_FEE_PAYER_SECRET; reset(); });

  it("lets Wono pay the fee and account rent, co-signing only the checked transfer", async () => {
    const invoice = await newInvoice("10");
    const payer = CUSTOMER_SOL.publicKey.toBase58();
    await payments.createAttempt(invoice.id, `${KEY}p`, [
      { assetId: SOL, amountOut: "4000000", sourceAddress: payer },
      { assetId: BONK, amountOut: "6000000", sourceAddress: payer },
    ]);
    const ids = (await parts(invoice.id)).map((part) => part.id);
    const request = (await payments.requestApproval(ids, `${KEY}p`, payer, "signTransaction")) as any;
    assert.equal(request.sponsored, true);
    const tx = Transaction.from(Buffer.from(request.transaction, "base64"));
    assert.equal(tx.feePayer!.toBase58(), SPONSOR.publicKey.toBase58());
    const createAta = tx.instructions.find((instruction) => instruction.keys.length === 6)!;
    assert.equal(createAta.keys[0]!.pubkey.toBase58(), SPONSOR.publicKey.toBase58(), "sponsor pays account rent");

    tx.partialSign(CUSTOMER_SOL);
    await payments.reportOutcome(ids, `${KEY}p`, { type: "solana_signed", signedTransaction: tx.serialize({ requireAllSignatures: false }).toString("base64") });
    const after = (await parts(invoice.id));
    assert.ok(after.every((part) => part.state === "submitted"));
    const broadcast = Transaction.from(Buffer.from(sent.at(-1)!, "base64"));
    assert.ok(broadcast.verifySignatures(true), "both signatures present on the broadcast bytes");
    assert.equal(after[0]!.fee_payer, SPONSOR.publicKey.toBase58());
  });

  it("refuses to co-sign when the wallet adds a priority fee above the cap", async () => {
    const invoice = await newInvoice("2");
    const payer = CUSTOMER_SOL.publicKey.toBase58();
    await payments.createAttempt(invoice.id, `${KEY}q`, [{ assetId: SOL, amountOut: "2000000", sourceAddress: payer }]);
    const [part] = (await parts(invoice.id));
    const request = (await payments.requestApproval([part!.id], `${KEY}q`, payer, "signTransaction")) as any;
    const prepared = Transaction.from(Buffer.from(request.transaction, "base64"));
    const greedy = new Transaction({ feePayer: prepared.feePayer!, blockhash: prepared.recentBlockhash!, lastValidBlockHeight: request.lastValidBlockHeight });
    greedy.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 }), ...prepared.instructions);
    greedy.partialSign(CUSTOMER_SOL);
    const before = sent.length;
    await payments.reportOutcome([part!.id], `${KEY}q`, { type: "solana_signed", signedTransaction: greedy.serialize({ requireAllSignatures: false }).toString("base64") });
    assert.equal((await parts(invoice.id))[0]!.state, "unknown");
    assert.equal(sent.length, before, "nothing broadcast");
  });

  it("falls back to the customer paying when the sponsor wallet runs low", async () => {
    sponsorLamports = 1_000;
    try {
      const invoice = await newInvoice("2");
      const payer = CUSTOMER_SOL.publicKey.toBase58();
      await payments.createAttempt(invoice.id, `${KEY}r`, [{ assetId: SOL, amountOut: "2000000", sourceAddress: payer }]);
      const [part] = (await parts(invoice.id));
      const request = (await payments.requestApproval([part!.id], `${KEY}r`, payer, "signTransaction")) as any;
      assert.equal(request.sponsored, false);
      assert.equal(Transaction.from(Buffer.from(request.transaction, "base64")).feePayer!.toBase58(), payer);
    } finally {
      sponsorLamports = 1_000_000_000;
    }
  });
});
