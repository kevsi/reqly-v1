/**
 * Tests for response-cache.ts (Phase 7.1 LRU response cache).
 * Mocks idb with an in-memory store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Provide a stub `window` so browser guard passes
Object.defineProperty(globalThis, "window", { value: globalThis, writable: true });

interface Row {
  key: string;
  content: string;
  model: string;
  source: string;
  createdAt: number;
  lastAccessedAt: number;
}

// Simulate an index on lastAccessedAt via a sorted view of the map.
const store = new Map<string, Row>();

function sortedByAccess(): Row[] {
  return Array.from(store.values()).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
}

vi.mock("idb", () => {
  const fakeIndex = {
    getAll: () => Promise.resolve(sortedByAccess()),
  };
  const fakeStore = {
    get: (key: string) => Promise.resolve(store.get(key)),
    put: (value: Row) => {
      store.set(value.key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    count: () => Promise.resolve(store.size),
    index: (_name: string) => fakeIndex,
  };
  const fakeTx = {
    store: fakeStore,
    done: Promise.resolve(),
  };
  const fakeDb = {
    transaction: () => fakeTx,
    count: () => Promise.resolve(store.size),
    clear: () => {
      store.clear();
      return Promise.resolve();
    },
  };
  return {
    openDB: () => Promise.resolve(fakeDb),
  };
});

import {
  computeResponseKey,
  getCachedResponse,
  setCachedResponse,
  responseCacheSize,
  clearResponseCache,
} from "@/src/ai/cloud-engine/response-cache";

describe("response-cache (LRU)", () => {
  beforeEach(async () => {
    await clearResponseCache();
  });

  it("computeResponseKey is deterministic and case-insensitive", async () => {
    const k1 = await computeResponseKey("GET /users");
    const k2 = await computeResponseKey("get /USERS");
    const k3 = await computeResponseKey("  GET /users  ");
    expect(k1).toBe(k2);
    expect(k1).toBe(k3);
    expect(k1).toHaveLength(64); // SHA-256 hex
  });

  it("returns null on miss", async () => {
    const result = await getCachedResponse("nope");
    expect(result).toBeNull();
  });

  it("stores and retrieves a response", async () => {
    await setCachedResponse("k1", "answer text", "gpt-5", "diagnose");
    const r = await getCachedResponse("k1");
    expect(r?.content).toBe("answer text");
    expect(r?.model).toBe("gpt-5");
    expect(r?.source).toBe("diagnose");
  });

  it("promotes lastAccessedAt on read (LRU semantics)", async () => {
    await setCachedResponse("k1", "first", "m", "s");
    await setCachedResponse("k2", "second", "m", "s");
    // Wait a bit so timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    // Reading k1 should promote it
    await getCachedResponse("k1");
    // Now k2 has older lastAccessedAt — it should be evicted first
    await setCachedResponse("k3", "third", "m", "s", { maxEntries: 2 });
    // After insertion at limit, k2 should be gone (oldest LRU)
    expect(await getCachedResponse("k1")).not.toBeNull();
    expect(await getCachedResponse("k2")).toBeNull();
    expect(await getCachedResponse("k3")).not.toBeNull();
  });

  it("evicts least-recently-used when over maxEntries", async () => {
    await setCachedResponse("a", "x", "m", "s");
    await new Promise((r) => setTimeout(r, 5));
    await setCachedResponse("b", "y", "m", "s");
    await new Promise((r) => setTimeout(r, 5));
    await setCachedResponse("c", "z", "m", "s", { maxEntries: 2 });
    // a is the oldest — should be evicted
    expect(await getCachedResponse("a")).toBeNull();
    expect(await getCachedResponse("b")).not.toBeNull();
    expect(await getCachedResponse("c")).not.toBeNull();
  });

  it("size reflects entry count", async () => {
    expect(await responseCacheSize()).toBe(0);
    await setCachedResponse("a", "x", "m", "s");
    await setCachedResponse("b", "y", "m", "s");
    expect(await responseCacheSize()).toBe(2);
  });

  it("clear removes all entries", async () => {
    await setCachedResponse("a", "x", "m", "s");
    await setCachedResponse("b", "y", "m", "s");
    await clearResponseCache();
    expect(await responseCacheSize()).toBe(0);
  });
});
