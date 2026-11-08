import "server-only";
import { randomBytes } from "node:crypto";
import { MongoClient, type ClientSession, type Collection, type Db, type Document } from "mongodb";

/**
 * Durable storage: MongoDB (Atlas in production, a replica set so transactions work).
 * Every money-relevant write goes through `transaction`; unique indexes make duplicate
 * routes and duplicate settlement credits impossible rather than merely unlikely.
 *
 * Documents keep the snake_case field names and string `id` of the old SQL rows (unique
 * index on `id`; Mongo's own ObjectId `_id` is never used), so row types stay the same. Read through `col()` with the
 * `NO_ID` projection, or `plain()`, so `_id` never leaks into views.
 */
export type Session = ClientSession;

export interface Collections {
  users: Document;
  sessions: Document;
  merchants: Document;
  invoices: Document;
  attempts: Document;
  contributions: Document;
  settlements: Document;
  settlement_links: Document;
  events: Document;
}
export type CollectionName = keyof Collections;

const globalStore = globalThis as unknown as { __wonoMongo?: Promise<{ client: MongoClient; db: Db }> };

function uri(): string {
  const value = process.env.MONGODB_URI?.trim();
  if (!value) throw new Error("MONGODB_URI is not set.");
  return value;
}

async function connect(): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri(), { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB?.trim() || "wono");
  await ensureIndexes(db);
  return { client, db };
}

async function ensureIndexes(db: Db): Promise<void> {
  const str = { $type: "string" };
  await Promise.all([
    ...(["users", "merchants", "invoices", "attempts", "contributions", "settlements"] as const).map((name) => db.collection(name).createIndex({ id: 1 }, { unique: true })),
    db.collection("sessions").createIndex({ token_hash: 1 }, { unique: true }),
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ user_id: 1 }),
    db.collection("merchants").createIndex({ user_id: 1 }, { unique: true }),
    db.collection("merchants").createIndex({ api_key_hash: 1 }, { unique: true, partialFilterExpression: { api_key_hash: str } }),
    db.collection("invoices").createIndex({ merchant_id: 1, reference: 1 }, { unique: true, partialFilterExpression: { reference: str } }),
    db.collection("invoices").createIndex({ merchant_id: 1, created_at: -1 }),
    db.collection("attempts").createIndex({ invoice_id: 1, token_hash: 1 }, { unique: true }),
    db.collection("contributions").createIndex({ invoice_id: 1, position: 1 }),
    db.collection("contributions").createIndex({ attempt_id: 1 }),
    db.collection("contributions").createIndex({ deposit_address: 1 }, { unique: true, partialFilterExpression: { deposit_address: str } }),
    db.collection("contributions").createIndex({ chain: 1, tx_hash: 1 }),
    db.collection("settlements").createIndex({ chain: 1, signature: 1 }, { unique: true }),
    db.collection("settlements").createIndex({ invoice_id: 1 }),
    db.collection("settlement_links").createIndex({ settlement_id: 1, contribution_id: 1 }, { unique: true }),
    db.collection("settlement_links").createIndex({ contribution_id: 1 }),
    db.collection("events").createIndex({ invoice_id: 1, seq: 1 }),
  ]);
}

export async function database(): Promise<Db> {
  globalStore.__wonoMongo ??= connect().catch((error) => {
    globalStore.__wonoMongo = undefined;
    throw error;
  });
  return (await globalStore.__wonoMongo).db;
}

export async function col<T extends Document = Document>(name: CollectionName): Promise<Collection<T>> {
  return (await database()).collection<T>(name);
}

/** Projection that hides Mongo's `_id`. */
export const NO_ID = { projection: { _id: 0 } } as const;

/** Strip `_id` from a document read without `NO_ID`. */
export function plain<T>(doc: (T & { _id?: unknown }) | null | undefined): T | undefined {
  if (!doc) return undefined;
  const { _id, ...rest } = doc as Record<string, unknown>;
  void _id;
  return rest as T;
}

/** True when `error` is a duplicate-key violation of a unique index. */
export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/**
 * Run `work` in a MongoDB transaction. Pass `{ session }` to every operation inside.
 * Transient conflicts are retried by the driver, so `work` must be safe to re-run.
 */
export async function transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
  await database();
  const { client } = await globalStore.__wonoMongo!;
  const session = client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** Event order: time first, then a random tiebreak (SQL used an autoincrement id). */
function eventSeq(): string {
  return `${now()}#${randomBytes(4).toString("hex")}`;
}

export async function logEvent(invoiceId: string, type: string, data?: unknown, contributionId?: string, session?: Session): Promise<void> {
  const events = await col("events");
  await events.insertOne(
    { invoice_id: invoiceId, contribution_id: contributionId ?? null, type, data: data === undefined ? null : JSON.stringify(data), created_at: now(), seq: eventSeq() },
    session ? { session } : {},
  );
}

/** Close the client (tests). */
export async function closeDatabase(): Promise<void> {
  const current = globalStore.__wonoMongo;
  globalStore.__wonoMongo = undefined;
  if (current) await (await current).client.close();
}
