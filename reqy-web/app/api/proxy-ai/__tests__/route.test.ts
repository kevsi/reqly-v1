import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security/dns-cache", () => ({
  resolveCached: vi.fn(async (hostname: string) => {
    if (
      hostname === "example.com" ||
      hostname === "myproxy.example.com" ||
      hostname === "ollama.example.com"
    ) {
      return "93.184.216.34";
    }
    return null;
  }),
}));

import { POST } from "../route";

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return {
    json: () => Promise.resolve(body),
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/proxy-ai dispatcher", () => {
  it("returns 400 for invalid JSON", async () => {
    const req = {
      json: () => Promise.reject(new Error("Invalid JSON")),
      headers: { get: () => null },
    } as unknown as Request;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON in request body");
  });

  it("returns 400 for non-object body", async () => {
    const res = await POST(makeRequest("string"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing provider", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown provider", async () => {
    const res = await POST(
      makeRequest({
        provider: "unknown_provider",
        message: "Hello",
        apiKey: "sk-test",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Unknown provider");
  });

  it("returns 400 when previousTurns exceeds the maximum", async () => {
    const previousTurns = Array.from({ length: 6 }, (_, _index) => ({
      assistantToolCalls: [],
      toolResults: [],
    }));

    const res = await POST(
      makeRequest({
        provider: "openai",
        apiKey: "sk-test",
        message: "Hello",
        previousTurns,
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Too many previous turns");
  });

  it("returns 400 for invalid custom provider URL", async () => {
    const res = await POST(
      makeRequest({
        provider: "custom",
        apiKey: "sk-test",
        message: "Hello",
        openaiUrl: "http://localhost:8080/v1",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("cannot point to localhost");
  });

  it("dispatches to OpenAI handler for 'custom' provider with valid openaiUrl", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({ choices: [{ message: { content: "Hello from custom" } }] }),
        ),
    } as Response);

    const res = await POST(
      makeRequest({
        provider: "custom",
        apiKey: "sk-test",
        message: "Hello",
        openaiUrl: "https://myproxy.example.com/v1/",
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://myproxy.example.com/v1/chat/completions",
      expect.any(Object),
    );
    const body = await res.json();
    expect(body.content).toBe("Hello from custom");
  });

  it("returns 403 for invalid ollama host (private IP, not loopback)", async () => {
    const res = await POST(
      makeRequest({
        provider: "ollama",
        host: "10.0.0.1",
        message: "Hi",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Invalid host");
  });

  it("dispatches to OpenAI handler for 'openai' provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "Hello" } }] })),
    } as Response);

    const res = await POST(
      makeRequest({
        provider: "openai",
        apiKey: "sk-test",
        message: "Hello",
        system: "You are helpful.",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("Hello");
  });

  it("dispatches to Anthropic handler for 'anthropic' provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "Hi from Claude" }],
        }),
    } as Response);

    const res = await POST(
      makeRequest({
        provider: "anthropic",
        apiKey: "sk-ant-test",
        message: "Hi",
        system: "You are Claude.",
      }),
    );
    const body = await res.json();
    expect(body.content).toBe("Hi from Claude");
  });

  it("dispatches to Gemini handler for 'gemini' provider", async () => {
    const responseData = {
      candidates: [{ content: { parts: [{ text: "Hi from Gemini" }] } }],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    } as Response);

    const res = await POST(
      makeRequest({
        provider: "gemini",
        apiKey: "AIza-test",
        message: "Hi",
        system: "You are Gemini.",
      }),
    );
    const body = await res.json();
    expect(body.content).toBe("Hi from Gemini");
  });

  it("dispatches to DeepSeek handler for 'deepseek' provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({ choices: [{ message: { content: "Hi from DeepSeek" } }] }),
        ),
    } as Response);

    const res = await POST(
      makeRequest({
        provider: "deepseek",
        apiKey: "sk-ds-test",
        message: "Hi",
        system: "You are DeepSeek.",
      }),
    );
    const body = await res.json();
    expect(body.content).toBe("Hi from DeepSeek");
  });

  it("dispatches to Ollama handler for 'ollama' provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Hi from Ollama" } }],
        }),
    } as Response);

    const res = await POST(
      makeRequest({
        provider: "ollama",
        message: "Hi",
        host: "ollama.example.com",
      }),
    );
    const body = await res.json();
    expect(body.content).toBe("Hi from Ollama");
  });

  it("returns 500 with a sanitized message on unhandled error (does not leak upstream details)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));

    const res = await POST(
      makeRequest({
        provider: "openai",
        apiKey: "sk-test",
        message: "Hello",
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("AI provider request failed");
    expect(body.error).not.toContain("Network failure");
  });
});
