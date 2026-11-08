import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { solanaKeypairSigner } from "../src/solana.ts";

const BLOCKHASH = "11111111111111111111111111111111";

function build(payer: PublicKey, instruction: TransactionInstruction): string {
  const transaction = new Transaction({ feePayer: payer, recentBlockhash: BLOCKHASH }).add(instruction);
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

describe("solanaKeypairSigner", () => {
  const keypair = Keypair.generate();
  const signer = solanaKeypairSigner(keypair);
  const transfer = SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });

  it("signs a transfer that names its key", async () => {
    const signed = Transaction.from(Buffer.from(await signer.sign(build(keypair.publicKey, transfer)), "base64"));
    assert.equal(signer.address, keypair.publicKey.toBase58());
    assert.ok(signed.signatures.find((entry) => entry.publicKey.equals(keypair.publicKey))?.signature);
  });

  it("refuses unknown programs and transactions it does not sign", async () => {
    const rogue = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(0) });
    await assert.rejects(signer.sign(build(keypair.publicKey, rogue)), /unexpected program/);
    const other = Keypair.generate().publicKey;
    await assert.rejects(signer.sign(build(other, SystemProgram.transfer({ fromPubkey: other, toPubkey: other, lamports: 1 }))), /not a signer/);
  });
});
