// Shapes captured from live Aurora responses on 2026-11-05 (addresses replaced).
import type { QuoteRequestBody } from "../src/index.ts";

export const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const MERCHANT = "7XHa8dmBM1veGdktRyuCojtV9Z7scgvvzBvmBs8b14rV";
export const CUSTOMER_EVM = "0xae711a0bcdb064a7aefcd772282f50df639bdd6f";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function quoteResponse(request: QuoteRequestBody, overrides: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-11-05T11:21:48.671Z",
    signature: "ed25519:4QoZTdWNKsV8EKsmHzmoGFAroJVV1ULSaTuVN7bQqgENJuBNMxb8M7yCQAQL7QHzrSo4bHLd1GTPg5stWnit5oLR",
    correlationId: "28079227-4347-4dd6-b634-ac67cb487782",
    quoteRequest: {
      ...request,
      confidentiality: "public",
      referral: "aurora-p1k65gs2ik",
      appFees: [{ recipient: "2da316c13fcafc3a6c957ca6a9143622119a1a747bae0975c41a579d21a4cb6e", fee: 2 }],
    },
    quote: {
      timeEstimate: 32,
      ...(request.dry ? {} : {
        // Live responses return a refund deadline three days after the requested one.
        deadline: new Date(Date.parse(request.deadline) + 3 * 86_400_000).toISOString(),
        timeWhenInactive: new Date(Date.parse(request.deadline) + 3 * 86_400_000).toISOString(),
        depositAddress: "0x94F43faEDF2710598c880149aBb055f5d2CB9e0A",
      }),
      amountIn: "12320040",
      amountInFormatted: "12.32004",
      amountInUsd: "12.318265914240",
      minAmountIn: "12259720",
      amountOut: request.amount,
      amountOutFormatted: "12.0",
      amountOutUsd: "11.998272000000",
      minAmountOut: request.amount,
      refundFee: "2400",
      withdrawFee: "256213",
      ...overrides,
    },
  };
}

export function statusResponse(quote: ReturnType<typeof quoteResponse>, status: string, swapDetails: Record<string, unknown> = {}) {
  return {
    correlationId: "cc869b26-646a-492f-8c3f-3a0dbc5a8a18",
    quoteResponse: { ...quote, quoteRequest: { ...quote.quoteRequest, virtualChainRecipient: null, virtualChainRefundRecipient: null } },
    status,
    updatedAt: "2026-11-05T11:21:51.863Z",
    swapDetails: {
      intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [],
      amountIn: null, amountOut: null, refundedAmount: null, refundReason: null, depositedAmount: null,
      ...swapDetails,
    },
  };
}

export function solanaTx(options: { err?: unknown; pre?: string; post?: string; owner?: string; mint?: string }) {
  const owner = options.owner ?? MERCHANT;
  const mint = options.mint ?? USDC_MINT;
  const balance = (amount: string) => ({ accountIndex: 1, mint, owner, programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", uiTokenAmount: { amount, decimals: 6 } });
  return {
    slot: 380000000,
    blockTime: 1793000000,
    meta: {
      err: options.err ?? null,
      preTokenBalances: options.pre === undefined ? [] : [balance(options.pre)],
      postTokenBalances: [balance(options.post ?? "12000000")],
    },
  };
}
