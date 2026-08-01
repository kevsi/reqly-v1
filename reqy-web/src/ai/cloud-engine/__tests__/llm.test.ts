import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamLLM, type StreamLLMOptions } from "@/src/ai/cloud-engine/llm";
import type { RequestContext } from "@/src/ai/types";

const baseCtx: RequestContext = {
  request: {
    method: "GET",
    url: "https://example.com",
    headers: {},
    body: null,
    authType: "none",
  },
  timestamp: Date.now(),
};

const baseOpts: StreamLLMOptions = {
  provider: "openai",
  apiKey: "sk-test",
  question: "Quel est le statut ?",
  ctx: baseCtx,
  diagnostics: [],
};

function mockFetch(response: Response) {
  return vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("streamLLM", () => {
  beforeEach(() => {
    if (typeof vi !== "undefined") {
      vi.unstubAllGlobals();
    }
  });

  afterEach(() => {
    if (typeof vi !== "undefined") {
      vi.unstubAllGlobals();
    }
  });

  it("parses SSE chunks and yields tokens (openai-compatible)", async () => {
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const res = new Response(sseStream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    mockFetch(res);

    const tokens: Array<{ type: string; value: string }> = [];
    for await (const t of streamLLM(baseOpts)) {
      tokens.push(t);
    }

    expect(tokens).toEqual([
      { type: "text", value: "Hello" },
      { type: "text", value: " " },
      { type: "text", value: "world" },
    ]);
  });

  it("yields a single token for JSON fallback (anthropic / gemini)", async () => {
    const res = new Response(JSON.stringify({ content: "Single response" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    mockFetch(res);

    const tokens: Array<{ type: string; value: string }> = [];
    for await (const t of streamLLM(baseOpts)) {
      tokens.push(t);
    }

    expect(tokens).toEqual([{ type: "text", value: "Single response" }]);
  });

  it("throws on proxy error", async () => {
    const res = new Response(JSON.stringify({ error: "Bad API key" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

    mockFetch(res);

    await expect(
      (async () => {
        for await (const _ of streamLLM(baseOpts)) {
          void _;
        }
      })(),
    ).rejects.toThrow("Bad API key");
  });

  it("throws generic error when body is non-JSON on failure", async () => {
    const res = new Response("Not Found", { status: 404 });
    mockFetch(res);

    await expect(
      (async () => {
        for await (const _ of streamLLM(baseOpts)) {
          void _;
        }
      })(),
    ).rejects.toThrow("Proxy error 404");
  });

  it("skips malformed SSE lines gracefully", async () => {
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: not valid json\n\n"));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"B"}}]}\n\n'));
        controller.close();
      },
    });

    const res = new Response(sseStream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    mockFetch(res);

    const tokens: Array<{ type: string; value: string }> = [];
    for await (const t of streamLLM(baseOpts)) {
      tokens.push(t);
    }

    expect(tokens).toEqual([
      { type: "text", value: "A" },
      { type: "text", value: "B" },
    ]);
  });
});
