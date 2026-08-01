/**
 * Phase 7.1 — LRU response cache (IndexedDB)
 *
 * Caches AI responses keyed by a request signature (method+url+body hash).
 * Evicts least-recently-used entries when the cache exceeds a soft limit.
 * The cache survives reloads (IndexedDB persistence) — useful for repeated
 * diagnoses on the same endpoint.
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "reqly-ai-response-cache";
const STORE_NAME = "responses";
const DB_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 200;

let dbPromise: Promise<IDBPDatabase> | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    throw new Error("response-cache: IndexedDB only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("lastAccessedAt", "lastAccessedAt");
        }
      },
    });
  }
  return dbPromise;
}

export interface CachedResponse {
  key: string;
  content: string;
  model: string;
  source: string; // e.g. "natural-language", "diagnose", "explain"
  createdAt: number;
  lastAccessedAt: number;
}

/** Compute a stable cache key from request signature. */
export async function computeResponseKey(signature: string): Promise<string> {
  const buf = new TextEncoder().encode(signature.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface CacheOptions {
  maxEntries?: number;
}

export async function getCachedResponse(key: string): Promise<CachedResponse | null> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const row = (await tx.store.get(key)) as CachedResponse | undefined;
  if (!row) {
    await tx.done;
    return null;
  }
  // LRU promotion
  row.lastAccessedAt = Date.now();
  await tx.store.put(row);
  await tx.done;
  return row;
}

export async function setCachedResponse(
  key: string,
  content: string,
  model: string,
  source: string,
  options: CacheOptions = {}
): Promise<void> {
  const db = await getDb();
  const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = Date.now();

  const tx = db.transaction(STORE_NAME, "readwrite");
  await tx.store.put({
    key,
    content,
    model,
    source,
    createdAt: now,
    lastAccessedAt: now,
  } satisfies CachedResponse);

  // Evict LRU entries when over the soft limit
  const all = (await tx.store.index("lastAccessedAt").getAll()) as CachedResponse[];
  if (all.length > max) {
    const sorted = all.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const toDelete = sorted.slice(0, all.length - max);
    for (const e of toDelete) {
      await tx.store.delete(e.key);
    }
  }
  await tx.done;
}

export async function responseCacheSize(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_NAME);
}

export async function clearResponseCache(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
