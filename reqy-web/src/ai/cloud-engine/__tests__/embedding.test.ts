import { describe, it, expect, beforeEach, vi } from "vitest";

Object.defineProperty(globalThis, "window", { value: globalThis, writable: true });

const store = new Map<
  string,
  { key: string; embedding: number[]; model: string; createdAt: number }
>();

vi.mock("idb", () => {
  function fakeTx() {
    const txDone = Promise.resolve();
    return {
      objectStore: () => ({
        get: (key: string) => Promise.resolve(store.get(key)),
        put: (value) => {
          store.set(value.key, value);
          return Promise.resolve();
        },
      }),
      done: txDone,
    };
  }
  function fakeDb() {
    return {
      get: (_s: string, key: string) => Promise.resolve(store.get(key)),
      put: (_s: string, value: unknown) => {
        store.set(value.key, value);
        return Promise.resolve();
      },
      count: () => Promise.resolve(store.size),
      clear: () => {
        store.clear();
        return Promise.resolve();
      },
      transaction: (_s: string, _mode: string) => fakeTx(),
    };
  }
  return { openDB: () => Promise.resolve(fakeDb()) };
});

import { clearCache } from "@/src/ai/cloud-engine/embedding-cache";

const mockEmbedApi = vi.fn();

beforeEach(async () => {
  store.clear();
  mockEmbedApi.mockReset();
  globalThis.fetch = vi.fn((url: string, _opts?: RequestInit) => {
    if (url === "/api/embed") return mockEmbedApi();
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;
});

import { getEmbedding, getEmbeddings } from "@/src/ai/cloud-engine/embedding";

const MODEL = "jina-embeddings-v3";

describe("embedding orchestrator", () => {
  beforeEach(async () => {
    await clearCache();
  });

  it("returns cached embedding without calling API", async () => {
    store.set(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824::jina-embeddings-v3",
      {
        key: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824::jina-embeddings-v3",
        embedding: [0.1, 0.2, 0.3],
        model: MODEL,
        createdAt: Date.now(),
      },
    );

    const result = await getEmbedding("hello", MODEL);
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbedApi).not.toHaveBeenCalled();
  });

  it("calls API on cache miss and stores result", async () => {
    mockEmbedApi.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: MODEL,
          embeddings: [[0.5, 0.6, 0.7]],
          usage: { total_tokens: 3, prompt_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getEmbedding("world", MODEL);
    expect(result).toEqual([0.5, 0.6, 0.7]);
    expect(mockEmbedApi).toHaveBeenCalledTimes(1);

    const cached = await getEmbedding("world", MODEL);
    expect(cached).toEqual([0.5, 0.6, 0.7]);
    expect(mockEmbedApi).toHaveBeenCalledTimes(1);
  });

  it("batch get returns cached + fetched for mixed set", async () => {
    store.set(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824::jina-embeddings-v3",
      {
        key: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824::jina-embeddings-v3",
        embedding: [0.1, 0.2],
        model: MODEL,
        createdAt: Date.now(),
      },
    );

    mockEmbedApi.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: MODEL,
          embeddings: [[0.3, 0.4]],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getEmbeddings(["hello", "missing"], MODEL);
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(mockEmbedApi).toHaveBeenCalledTimes(1);
  });

  it("throws on API error", async () => {
    mockEmbedApi.mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    await expect(getEmbedding("test", MODEL)).rejects.toThrow("Unauthorized");
  });
});
