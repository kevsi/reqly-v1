import { describe, it, expect, vi, afterEach } from "vitest";
import { executeRequest, runCollection } from "../runner.js";
import type { ExportBundle, RunnerContext } from "../types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ctx(): RunnerContext {
  return { vars: new Map(), envVars: new Map(), cookies: new Map(), iteration: 0 };
}

describe("retry — transient status codes", () => {
  it("retries on 503 and succeeds once a 200 comes back", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "flaky", method: "GET", url: "https://httpbin.org/anything", endpoint: "/anything" },
      ctx(),
      5000,
      { timeoutMs: 5000, retries: 3, retryDelayMs: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(200);
    expect(result.passed).toBe(true);
  });

  it("does not retry a 404 (non-transient)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      {
        name: "missing",
        method: "GET",
        url: "https://httpbin.org/anything",
        endpoint: "/anything",
      },
      ctx(),
      5000,
      { timeoutMs: 5000, retries: 3, retryDelayMs: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(404);
    expect(result.passed).toBe(false);
  });

  it("respects a custom retryOnStatus list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      {
        name: "limited",
        method: "GET",
        url: "https://httpbin.org/anything",
        endpoint: "/anything",
      },
      ctx(),
      5000,
      { timeoutMs: 5000, retries: 2, retryOnStatus: [429], retryDelayMs: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });

  it("gives up after maxRetries and returns the last transient status", async () => {
    // mockResolvedValueOnce per attempt: a Response body stream is single-use,
    // so reusing one object across retries would throw on the second read.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "down", method: "GET", url: "https://httpbin.org/anything", endpoint: "/anything" },
      ctx(),
      5000,
      { timeoutMs: 5000, retries: 2, retryDelayMs: 1 },
    );

    // 1 initial + 2 retries = 3 attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(503);
    expect(result.passed).toBe(false);
  });
});
describe("retry — network errors", () => {
  it("retries on a thrown network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "neterr", method: "GET", url: "https://httpbin.org/anything", endpoint: "/anything" },
      ctx(),
      5000,
      { timeoutMs: 5000, retries: 2, retryDelayMs: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });

  it("returns an error result after exhausting retries on network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "neterr", method: "GET", url: "https://httpbin.org/anything", endpoint: "/anything" },
      ctx(),
      5000,
      { timeoutMs: 5000, retries: 1, retryDelayMs: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/fetch failed/);
  });
});

describe("retry — disabled by default", () => {
  it("does not retry when retries is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "down", method: "GET", url: "https://httpbin.org/anything", endpoint: "/anything" },
      ctx(),
      5000,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(503);
  });
});

describe("bail — fail-fast in a collection", () => {
  function bundle(): ExportBundle {
    return {
      collections: [
        {
          name: "chain",
          requests: [
            { name: "first", method: "GET", url: "https://httpbin.org/a", endpoint: "/a" },
            { name: "second", method: "GET", url: "https://httpbin.org/b", endpoint: "/b" },
            { name: "third", method: "GET", url: "https://httpbin.org/c", endpoint: "/c" },
          ],
        },
      ],
    };
  }

  it("stops after the first failure in sequential mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await runCollection(bundle(), {
      timeoutMs: 5000,
      bail: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[1].passed).toBe(false);
  });

  it("runs everything when bail is not set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await runCollection(bundle(), { timeoutMs: 5000 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });
});
