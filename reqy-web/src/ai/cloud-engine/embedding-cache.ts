/**
 * Phase 3.16 — Local embeddings cache (IndexedDB)
 *
 * Avoids re-embedding the same text by caching vectors in IndexedDB.
 * Keys are SHA-256 hashes of the normalized text, so identical inputs
 * (modulo whitespace) share a single cache entry.
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "reqly-ai-cache";
const STORE_NAME = "embeddings";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    throw new Error("embedding-cache: IndexedDB only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/** Normalize text so trivial whitespace differences share the same key. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * SHA-256 hex digest of the normalized text.
 * Uses the Web Crypto API (available in all modern browsers + Node 18+).
 */
async function hashKey(text: string): Promise<string> {
  const norm = normalize(text);
  const buf = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface CachedEmbedding {
  key: string;
  embedding: number[];
  model: string;
  createdAt: number;
}

/** Fetch a single cached embedding, or null if not present. */
export async function getCachedEmbedding(
  text: string,
  model: string
): Promise<number[] | null> {
  const key = `${(await hashKey(text))}::${model}`;
  const db = await getDb();
  const row = (await db.get(STORE_NAME, key)) as CachedEmbedding | undefined;
  return row?.embedding ?? null;
}

/** Store a single embedding. */
export async function setCachedEmbedding(
  text: string,
  embedding: number[],
  model: string
): Promise<void> {
  const key = `${(await hashKey(text))}::${model}`;
  const db = await getDb();
  await db.put(STORE_NAME, {
    key,
    embedding,
    model,
    createdAt: Date.now(),
  } satisfies CachedEmbedding);
}

/**
 * Batch lookup: returns an array aligned with the input `texts`. Each
 * position is either the cached embedding (hit) or `null` (miss).
 */
export async function getCachedEmbeddings(
  texts: string[],
  model: string
): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];
  const db = await getDb();
  const keys = await Promise.all(texts.map((t) => hashKey(t)));
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const rows = await Promise.all(
    keys.map((k) => store.get(`${k}::${model}`) as Promise<CachedEmbedding | undefined>)
  );
  return rows.map((r) => r?.embedding ?? null);
}

/** Batch write: aligns with input arrays. */
export async function setCachedEmbeddings(
  texts: string[],
  embeddings: number[][],
  model: string
): Promise<void> {
  if (texts.length !== embeddings.length) {
    throw new Error("setCachedEmbeddings: length mismatch");
  }
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const now = Date.now();
  await Promise.all(
    texts.map(async (t, i) => {
      const k = `${await hashKey(t)}::${model}`;
      await store.put({
        key: k,
        embedding: embeddings[i],
        model,
        createdAt: now,
      } satisfies CachedEmbedding);
    })
  );
  await tx.done;
}

/** Number of cached embeddings (for stats). */
export async function cacheSize(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_NAME);
}

/** Drop all cached embeddings. */
export async function clearCache(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
