/**
 * A `sign` callback for wonoFetch / WonoPay backed by a Solana Keypair (e.g. an agent's key file).
 *
 *   const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
 *   const pay = wonoFetch({ ...solanaKeypairSigner(keypair), maxUsdc: "5" });
 *
 * Before signing it parses the transaction Wono built and refuses any instruction outside the
 * programs a Wono payment uses, and any transaction that does not name this key as a signer.
 * It signs only; Wono checks the signed bytes match what it built and broadcasts them.
 */
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, type Keypair } from "@solana/web3.js";

/** Programs a Wono payment transaction may touch. */
export const WONO_PAYMENT_PROGRAMS: readonly string[] = [
  SystemProgram.programId.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b9hvZbsiqW5xWH25efTNsLJA8knL", // Associated token account
  "MemoSq4gqABAXKb96qnH8TuNkiLgv1GVJR2tBCSmV8Ab", // Memo
];

export interface SolanaSigner {
  address: string;
  sign: (transaction: string) => Promise<string>;
}

export function solanaKeypairSigner(keypair: Keypair, options: { allowedPrograms?: readonly string[] } = {}): SolanaSigner {
  const allowed = new Set(options.allowedPrograms ?? WONO_PAYMENT_PROGRAMS);
  const address = keypair.publicKey.toBase58();
  return {
    address,
    sign: async (base64) => {
      const transaction = Transaction.from(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
      for (const instruction of transaction.instructions) {
        const program = instruction.programId.toBase58();
        if (!allowed.has(program)) throw new Error(`Refusing to sign: unexpected program ${program}.`);
      }
      if (!transaction.signatures.some((entry) => entry.publicKey.equals(new PublicKey(address)))) {
        throw new Error("Refusing to sign: this key is not a signer.");
      }
      transaction.partialSign(keypair);
      return btoa(String.fromCharCode(...transaction.serialize({ requireAllSignatures: false, verifySignatures: false })));
    },
  };
}
