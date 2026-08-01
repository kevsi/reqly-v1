import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security/dns-cache", () => ({
  resolveCached: vi.fn(async (hostname: string) => {
    if (
      hostname === "example.com" ||
      hostname === "myproxy.example.com" ||
      hostname === "myproxy.com" ||
      hostname === "ollama.example.com"
    ) {
      return "93.184.216.34";
    }
    return null;
  }),
}));

import { handleOpenAICompat } from "../handlers/openai-compat";

const validBody = {
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
  system: "You are a helpful assistant.",
  message: "Hello",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("handleOpenAICompat", () => {
  it("returns 400 if apiKey missing", async () => {
    const res = await handleOpenAICompat({ ...validBody, apiKey: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing API key");
  });

  it("returns provider error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: { message: "Incorrect API key" } })),
    } as Response);

    const res = await handleOpenAICompat(validBody, {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Incorrect API key");
  });

  it("returns content on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [{ message: { content: "Hello, world!" } }],
          }),
        ),
    } as Response);

    const res = await handleOpenAICompat(validBody, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("Hello, world!");
  });

  it("returns tool_calls when present in response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '{"city":"Paris"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    } as Response);

    const res = await handleOpenAICompat(validBody, {});
    const body = await res.json();
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("get_weather");
    expect(body.tool_calls[0].arguments).toBe('{"city":"Paris"}');
    expect(body.provider_tool_format).toBe("openai");
  });

  it("stream passthrough when stream=true and no tools", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: hello\n\n"));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    const res = await handleOpenAICompat({ ...validBody, stream: true }, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
  });

  it("does NOT stream passthrough when tools are present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [{ message: { content: "non-streamed with tools" } }],
          }),
        ),
    } as Response);

    const res = await handleOpenAICompat(
      { ...validBody, stream: true, tools: [{ name: "test" } as any] },
      {},
    );
    const body = await res.json();
    expect(body.content).toBe("non-streamed with tools");
  });

  it("uses correct endpoint per provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleOpenAICompat({ ...validBody, provider: "openrouter" }, {});
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");

    await handleOpenAICompat({ ...validBody, provider: "grok" }, {});
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.x.ai/v1/chat/completions");

    await handleOpenAICompat({ ...validBody, provider: "opencode-zen" }, {});
    expect(fetchMock.mock.calls[2][0]).toBe("https://opencode.ai/zen/v1/chat/completions");

    await handleOpenAICompat(
      { ...validBody, provider: "custom", openaiUrl: "https://myproxy.com/v1" },
      {},
    );
    expect(fetchMock.mock.calls[3][0]).toBe("https://myproxy.com/v1/chat/completions");
  });

  it("uses correct default model per provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleOpenAICompat({ ...validBody, provider: "openrouter", model: undefined }, {});
    const body1 = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body1.model).toBe("openai/gpt-5.2");

    await handleOpenAICompat({ ...validBody, provider: "openai", model: undefined }, {});
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body2.model).toBe("gpt-4o-mini");
  });

  it("falls back to raw text for legacy text format", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [{ text: "legacy response" }],
          }),
        ),
    } as Response);

    const res = await handleOpenAICompat(validBody, {});
    const body = await res.json();
    expect(body.content).toBe("legacy response");
  });

  it("handles non-JSON error body gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("Gateway Timeout"),
    } as Response);

    const res = await handleOpenAICompat(validBody, {});
    const body = await res.json();
    // Non-JSON body falls back to raw text error
    expect(body.error).toBe("Gateway Timeout");
  });
});
