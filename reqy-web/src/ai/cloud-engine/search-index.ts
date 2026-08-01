import { openDB, type IDBPDatabase } from "idb";
import { cosineSimilarity, topByScore } from "./cosine";
import { getEmbedding, getEmbeddings } from "./embedding";

const DB_NAME = "reqly-search-index";
const STORE_NAME = "vectors";
const DB_VERSION = 1;

export interface IndexedRequest {
  requestId: string;
  collectionId: string;
  collectionName: string;
  method: string;
  name: string;
  url: string;
  text: string;
  embedding: number[];
}

let dbPromise: Promise<IDBPDatabase> | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    throw new Error("search-index: IndexedDB only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "requestId" });
        }
      },
    });
  }
  return dbPromise;
}

export function buildSearchText(method: string, name: string, url: string, body?: string): string {
  return [method, name, url, body ?? ""].filter(Boolean).join(" ");
}

export async function indexRequest(
  requestId: string,
  collectionId: string,
  collectionName: string,
  method: string,
  name: string,
  url: string,
  body?: string,
): Promise<void> {
  const text = buildSearchText(method, name, url, body);
  const embedding = await getEmbedding(text);
  const db = await getDb();
  await db.put(STORE_NAME, {
    requestId,
    collectionId,
    collectionName,
    method,
    name,
    url,
    text,
    embedding,
  } satisfies IndexedRequest);
}

export async function indexRequests(
  requests: Array<{
    requestId: string;
    collectionId: string;
    collectionName: string;
    method: string;
    name: string;
    url: string;
    body?: string;
  }>,
): Promise<void> {
  const texts = requests.map((r) => buildSearchText(r.method, r.name, r.url, r.body));
  const embeddings = await getEmbeddings(texts);
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    await tx.store.put({
      requestId: r.requestId,
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      method: r.method,
      name: r.name,
      url: r.url,
      text: texts[i],
      embedding: embeddings[i],
    } satisfies IndexedRequest);
  }
  await tx.done;
}

export async function searchIndex(query: string, topK: number = 10): Promise<Array<{ item: IndexedRequest; score: number }>> {
  const qEmbedding = await getEmbedding(query);
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const all = await store.getAll() as IndexedRequest[];
  await tx.done;
  if (all.length === 0) return [];

  const scores = all.map((entry) => cosineSimilarity(qEmbedding, entry.embedding));
  return topByScore(all, scores, topK);
}

export async function removeFromIndex(requestId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, requestId);
}

export async function clearIndex(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}

export async function indexSize(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const all = await store.getAll();
  await tx.done;
  return all.length;
}
