import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";

function makeRequest(body: unknown, overrides?: Partial<{ cookies: Record<string, string> }>) {
  const cookieStore = overrides?.cookies ?? {};
  return {
    json: () => Promise.resolve(body),
    headers: {
      get: (name: string) => {
        if (name === "x-forwarded-for") return "127.0.0.1";
        return null;
      },
    },
    cookies: {
      get: (name: string) => (cookieStore[name] ? { value: cookieStore[name] } : undefined),
    },
  } as unknown as Request;
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.JINA_API_KEY;
});

describe("POST /api/embed", () => {
  it("returns 503 when JINA_API_KEY is not configured", async () => {
    const res = await POST(makeRequest({ input: "hello" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Jina API key not configured");
  });

  it("returns 400 for invalid JSON", async () => {
    process.env.JINA_API_KEY = "test-key";
    const req = {
      json: () => Promise.reject(new Error("Parse error")),
      headers: { get: () => null },
      cookies: { get: () => undefined },
    } as unknown as Request;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 for empty input", async () => {
    process.env.JINA_API_KEY = "test-key";
    const res = await POST(makeRequest({ input: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("input is required");
  });

  it("returns embeddings for valid input", async () => {
    process.env.JINA_API_KEY = "test-key";
    const fakeJinaResponse = {
      data: [
        { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
        { object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      usage: { total_tokens: 6, prompt_tokens: 3 },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(fakeJinaResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as typeof fetch;

    const res = await POST(makeRequest({ input: ["hello", "world"], model: "jina-embeddings-v3" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.embeddings).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    expect(body.model).toBe("jina-embeddings-v3");
    expect(body.usage).toEqual(fakeJinaResponse.usage);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.jina.ai/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );

    globalThis.fetch = originalFetch;
  });

  it("proxies Jina API errors", async () => {
    process.env.JINA_API_KEY = "test-key";
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as typeof fetch;

    const res = await POST(makeRequest({ input: "hello" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Jina API error 401");
  });
});
