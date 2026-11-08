import "server-only";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { decodeBase58, encodeBase58 } from "@wono/sdk";
import { rpc } from "./chain.ts";
import { SPONSOR_MAX_CU_PRICE, SPONSOR_MIN_LAMPORTS, solanaSponsorConfigured, solanaSponsorSecret } from "./config.ts";

const globalStore = globalThis as unknown as { __wonoSponsor?: Keypair | null };

/** Wono's fee-paying wallet, or undefined when sponsorship is not configured. */
export function sponsorKeypair(): Keypair | undefined {
  if (globalStore.__wonoSponsor !== undefined) return globalStore.__wonoSponsor ?? undefined;
  let keypair: Keypair | null = null;
  if (solanaSponsorConfigured()) {
    const bytes = solanaSponsorSecret() ?? decodeBase58(process.env.WONO_SOLANA_FEE_PAYER_SECRET!.trim());
    if (!bytes || bytes.length !== 64) throw new Error("WONO_SOLANA_FEE_PAYER_SECRET must be a 64-byte secret key.");
    keypair = Keypair.fromSecretKey(bytes);
  }
  globalStore.__wonoSponsor = keypair;
  return keypair ?? undefined;
}

const sponsorState = globalThis as unknown as { __wonoSponsorFunded?: { funded: boolean; at: number } };

/** The sponsor's public key if it can currently cover a transaction, else undefined. */
export async function availableSponsor(): Promise<PublicKey | undefined> {
  const sponsor = sponsorKeypair();
  if (!sponsor) return undefined;
  let funded = false;
  try {
    const { value } = await rpc("sol").call<{ value: number }>("getBalance", [sponsor.publicKey.toBase58(), { commitment: "confirmed" }]);
    funded = BigInt(value) >= SPONSOR_MIN_LAMPORTS;
  } catch {
    funded = false;
  }
  sponsorState.__wonoSponsorFunded = { funded, at: Date.now() };
  return funded ? sponsor.publicKey : undefined;
}

export type SponsorStatus =
  | { configured: false }
  | { configured: true; publicKey: string; lamports: bigint | null; minLamports: bigint; funded: boolean };

/** Paymaster state for the dashboard: public key and live balance only, never the secret. */
export async function sponsorStatus(): Promise<SponsorStatus> {
  const sponsor = sponsorKeypair();
  if (!sponsor) return { configured: false };
  const publicKey = sponsor.publicKey.toBase58();
  let lamports: bigint | null = null;
  try {
    const { value } = await rpc("sol").call<{ value: number }>("getBalance", [publicKey, { commitment: "confirmed" }]);
    lamports = BigInt(value);
  } catch {
    lamports = null;
  }
  const funded = lamports !== null && lamports >= SPONSOR_MIN_LAMPORTS;
  sponsorState.__wonoSponsorFunded = { funded, at: Date.now() };
  return { configured: true, publicKey, lamports, minLamports: SPONSOR_MIN_LAMPORTS, funded };
}

/**
 * Display hint for checkout: whether Solana gas is currently sponsored. Returns the last
 * known balance check and refreshes it in the background when older than a minute. The
 * approval path always re-checks; this only decides what the page says.
 */
export function sponsorFundedHint(): boolean {
  if (!sponsorKeypair()) return false;
  const known = sponsorState.__wonoSponsorFunded;
  if (!known || Date.now() - known.at > 60_000) void availableSponsor();
  return known?.funded ?? false;
}

export function associatedTokenAddress(owner: string, mint: string, program: string): string {
  return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(program)).toBase58();
}

export interface SolanaTransferSpec {
  from: string;
  to: string;
  amount: string;
  /** SPL mint; absent for native SOL. */
  mint?: string;
  decimals: number;
}

export interface PreparedSolanaTransfer {
  /** Unsigned legacy transaction, base64. The wallet signs it; Wono broadcasts the signed bytes. */
  transaction: string;
  lastValidBlockHeight: number;
  /** Fee payer and rent payer: Wono's sponsor wallet, or the customer. */
  feePayer: string;
}

async function tokenProgram(mint: string): Promise<PublicKey> {
  const info = await rpc("sol").call<{ value: { owner?: string } | null }>("getAccountInfo", [mint, { encoding: "base64", commitment: "confirmed" }]);
  const owner = info?.value?.owner;
  if (owner === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  throw new Error("Token mint is not owned by an SPL token program.");
}

/** The exact instructions a contribution transfer must contain. `rentPayer` funds any new token account. */
async function transferInstructions(spec: SolanaTransferSpec, rentPayer: PublicKey): Promise<TransactionInstruction[]> {
  const from = new PublicKey(spec.from);
  const to = new PublicKey(spec.to);
  const amount = BigInt(spec.amount);
  if (!spec.mint) return [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: amount })];
  const mint = new PublicKey(spec.mint);
  const program = await tokenProgram(spec.mint);
  const source = getAssociatedTokenAddressSync(mint, from, true, program);
  const destination = getAssociatedTokenAddressSync(mint, to, true, program);
  return [
    createAssociatedTokenAccountIdempotentInstruction(rentPayer, destination, to, mint, program),
    createTransferCheckedInstruction(source, mint, destination, from, amount, spec.decimals, [], program),
  ];
}

/** All transfers must share one payer. Several transfers become one atomic transaction. */
async function batchInstructions(specs: SolanaTransferSpec[], rentPayer: PublicKey): Promise<TransactionInstruction[]> {
  const payer = specs[0]?.from;
  if (!payer || specs.some((spec) => spec.from !== payer)) throw new Error("A Solana batch needs one payer.");
  return (await Promise.all(specs.map((spec) => transferInstructions(spec, rentPayer)))).flat();
}

/** A signed, unique invoice/batch reference prevents a historical transfer being claimed. */
function paymentMemo(reference: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    keys: [],
    data: Buffer.from(reference, "utf8"),
  });
}

/**
 * Build the batch. With `sponsor`, Wono's wallet is the fee payer and pays any account
 * rent; the customer signs only for their own transfers and Wono co-signs after checking.
 */
export async function buildSolanaTransfer(specs: SolanaTransferSpec[], reference: string, sponsor?: PublicKey): Promise<PreparedSolanaTransfer> {
  const spec = specs[0]!;
  const feePayer = sponsor ?? new PublicKey(spec.from);
  const instructions = await batchInstructions(specs, feePayer);
  const { value } = await rpc("sol").call<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [
    { commitment: "finalized" },
  ]);
  const transaction = new Transaction({ feePayer, blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight });
  transaction.add(...instructions, paymentMemo(reference));
  const size = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  if (size > 1100) throw new Error("Too many Solana sources for one transaction. Use fewer tokens.");
  return {
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    lastValidBlockHeight: value.lastValidBlockHeight,
    feePayer: feePayer.toBase58(),
  };
}

// Wallets may prepend compute-budget instructions or append Lighthouse guard assertions.
const ALLOWED_EXTRA_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
]);

export interface CheckedSolanaTransaction {
  signature: string;
  raw: string;
}

/** Priority fee a wallet set via ComputeBudget, in micro-lamports per CU (0 if none). */
function computeUnitPrice(instructions: TransactionInstruction[]): bigint {
  let price = 0n;
  for (const instruction of instructions) {
    if (!instruction.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (instruction.data[0] === 3 && instruction.data.length >= 9) price = instruction.data.readBigUInt64LE(1);
  }
  return price;
}

/**
 * Accept a wallet-signed transaction only if it has the expected fee payer, carries the
 * customer's valid signature, and contains exactly the expected transfer (plus fee/guard
 * instructions). For a sponsored transaction (`feePayer` is Wono's wallet), Wono then adds
 * its own signature: it only ever signs a message it has checked, and caps the priority fee
 * a wallet may add at Wono's expense.
 */
export async function checkSignedSolanaTransfer(
  signedBase64: string,
  specs: SolanaTransferSpec[],
  preparedBase64: string,
  reference: string,
  feePayer?: string,
): Promise<CheckedSolanaTransaction> {
  const spec = specs[0]!;
  const payer = feePayer ?? spec.from;
  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(signedBase64, "base64"));
  } catch {
    throw new Error("The wallet returned a transaction Wono cannot read.");
  }
  if (!preparedBase64) throw new Error("The prepared transaction is unavailable. Manual review required.");
  const prepared = Transaction.from(Buffer.from(preparedBase64, "base64"));
  if (transaction.recentBlockhash !== prepared.recentBlockhash) throw new Error("The signed transaction has a different blockhash.");
  if (transaction.feePayer?.toBase58() !== payer) throw new Error("The signed transaction has a different fee payer.");
  const customer = transaction.signatures.find((entry) => entry.publicKey.toBase58() === spec.from);
  if (!customer?.signature) throw new Error("The signed transaction is missing the wallet's signature.");
  if (!transaction.verifySignatures(false)) throw new Error("The signed transaction carries an invalid signature.");
  const expected = await batchInstructions(specs, new PublicKey(payer));
  expected.push(paymentMemo(reference));
  const actual = transaction.instructions.filter((instruction) => !ALLOWED_EXTRA_PROGRAMS.has(instruction.programId.toBase58()));
  const same = (a: TransactionInstruction, b: TransactionInstruction) =>
    a.programId.equals(b.programId) &&
    a.data.equals(b.data) &&
    a.keys.length === b.keys.length &&
    a.keys.every((key, index) => key.pubkey.equals(b.keys[index]!.pubkey));
  if (actual.length !== expected.length || !actual.every((instruction, index) => same(instruction, expected[index]!))) {
    throw new Error("The signed transaction does not match the prepared transfer.");
  }
  if (payer !== spec.from) {
    const sponsor = sponsorKeypair();
    if (!sponsor || sponsor.publicKey.toBase58() !== payer) throw new Error("This transaction was prepared for a fee payer Wono no longer holds.");
    if (computeUnitPrice(transaction.instructions) > SPONSOR_MAX_CU_PRICE) throw new Error("The wallet set a priority fee above what Wono sponsors.");
    transaction.partialSign(sponsor);
  }
  if (!transaction.verifySignatures(true)) throw new Error("The signed transaction is missing a valid signature.");
  const first = transaction.signatures[0]?.signature;
  if (!first) throw new Error("The signed transaction has no signature.");
  return { signature: encodeBase58(first), raw: transaction.serialize().toString("base64") };
}

/** Broadcast signed bytes. Rebroadcasting the same bytes cannot move funds twice. */
export async function broadcastSolana(raw: string): Promise<void> {
  await rpc("sol").call("sendTransaction", [raw, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 }]);
}

export async function currentBlockHeight(): Promise<number> {
  return rpc("sol").call<number>("getBlockHeight", [{ commitment: "finalized" }]);
}
