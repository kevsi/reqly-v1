/**
 * Tests for embedding-cache.ts. Mocks `idb` with an in-memory store so
 * the tests run in plain Node (no fake-indexeddb dependency).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Provide a stub `window` so embedding-cache.ts's browser guard passes in Node
Object.defineProperty(globalThis, "window", { value: globalThis, writable: true });

const store = new Map<string, { key: string; embedding: number[]; model: string; createdAt: number }>();

vi.mock("idb", () => {
  function fakeTx() {
    const txDone = Promise.resolve();
    return {
      objectStore: () => ({
        get: (key: string) => Promise.resolve(store.get(key)),
        put: (value: any) => {
          store.set(value.key, value);
          return Promise.resolve();
        },
      }),
      done: txDone,
    };
  }
  function fakeDb() {
    return {
      get: (s: string, key: string) => Promise.resolve(store.get(key)),
      put: (s: string, value: any) => {
        store.set(value.key, value);
        return Promise.resolve();
      },
      count: (s: string) => Promise.resolve(store.size),
      clear: (s: string) => {
        store.clear();
        return Promise.resolve();
      },
      transaction: (s: string, _mode: string) => fakeTx(),
    };
  }
  return {
    openDB: () => Promise.resolve(fakeDb()),
  };
});

import {
  getCachedEmbedding,
  setCachedEmbedding,
  getCachedEmbeddings,
  setCachedEmbeddings,
  cacheSize,
  clearCache,
} from "@/src/ai/cloud-engine/embedding-cache";

const MODEL = "jina-embeddings-v3";

describe("embedding-cache", () => {
  beforeEach(async () => {
    await clearCache();
  });

  it("returns null on miss", async () => {
    const result = await getCachedEmbedding("hello world", MODEL);
    expect(result).toBeNull();
  });

  it("stores and retrieves a single embedding", async () => {
    const embedding = new Array(1024).fill(0).map((_, i) => i / 1024);
    await setCachedEmbedding("hello world", embedding, MODEL);
    const result = await getCachedEmbedding("hello world", MODEL);
    expect(result).toEqual(embedding);
  });

  it("treats whitespace variants as the same key", async () => {
    const embedding = [0.1, 0.2, 0.3];
    await setCachedEmbedding("hello world", embedding, MODEL);
    const result = await getCachedEmbedding("  hello   world  ", MODEL);
    expect(result).toEqual(embedding);
  });

  it("returns null when model differs", async () => {
    await setCachedEmbedding("hello", [0.1], MODEL);
    const result = await getCachedEmbedding("hello", "different-model");
    expect(result).toBeNull();
  });

  it("batch get returns aligned hits/misses", async () => {
    const e1 = [0.1, 0.2];
    const e2 = [0.3, 0.4];
    await setCachedEmbedding("a", e1, MODEL);
    await setCachedEmbedding("b", e2, MODEL);

    const result = await getCachedEmbeddings(["a", "b", "c"], MODEL);
    expect(result[0]).toEqual(e1);
    expect(result[1]).toEqual(e2);
    expect(result[2]).toBeNull();
  });

  it("batch set writes all entries", async () => {
    await setCachedEmbeddings(["x", "y"], [[0.1], [0.2]], MODEL);
    expect(await cacheSize()).toBe(2);
    expect(await getCachedEmbedding("x", MODEL)).toEqual([0.1]);
    expect(await getCachedEmbedding("y", MODEL)).toEqual([0.2]);
  });

  it("batch set throws on length mismatch", async () => {
    await expect(
      setCachedEmbeddings(["a", "b"], [[0.1]], MODEL)
    ).rejects.toThrow("length mismatch");
  });

  it("clearCache empties the store", async () => {
    await setCachedEmbedding("a", [0.1], MODEL);
    await setCachedEmbedding("b", [0.2], MODEL);
    expect(await cacheSize()).toBe(2);
    await clearCache();
    expect(await cacheSize()).toBe(0);
  });
});
