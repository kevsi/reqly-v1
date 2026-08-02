import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/proxy-auth", () => ({ proxyAuthHeaders: () => ({}) }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { streamLLM, type LLMToken } from "../llm";

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l + "\n\n"));
      controller.close();
    },
  });
}

describe("streamLLM usage + system override", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits a usage event from the final SSE chunk (openai stream with tools)", async () => {
    fetchMock.mockResolvedValue(
      new Response(sseBody([
        'data: {"choices":[{"delta":{"content":"bonjour"}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"create_collection","arguments":"{\\"name\\":\\"X\\"}"}}]}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}',
        "data: [DONE]",
      ]), { headers: { "content-type": "text/event-stream" } }),
    );

    const out: LLMToken[] = [];
    for await (const t of streamLLM({
      provider: "openai", apiKey: "k", question: "q",
      ctx: { request: { method: "GET", url: "", headers: {}, body: undefined, authType: "none" }, timestamp: 0 },
      tools: [{ name: "create_collection", description: "c", parameters: { name: { type: "string" } } }],
    } as any)) {
      out.push(t as LLMToken);
    }

    const usage = out.find((t) => t.type === "usage") as { type: "usage"; usage: { inputTokens: number; outputTokens: number } } | undefined;
    expect(usage?.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("emits usage from JSON fallback (anthropic/gemini)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: "ok", usage: { input_tokens: 7, output_tokens: 3 } }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const out: LLMToken[] = [];
    for await (const t of streamLLM({
      provider: "anthropic", apiKey: "k", question: "q",
      ctx: { request: { method: "GET", url: "", headers: {}, body: undefined, authType: "none" }, timestamp: 0 },
    } as any)) {
      out.push(t as LLMToken);
    }

    const usage = out.find((t) => t.type === "usage") as { type: "usage"; usage: { inputTokens: number; outputTokens: number } } | undefined;
    expect(usage?.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("forwards a custom system override in the request body", async () => {
    const bodyCapture = { body: "" as string };
    fetchMock.mockImplementation(async (_u: any, init: any) => {
      bodyCapture.body = init.body;
      return new Response(JSON.stringify({ content: "x", usage: {} }), { headers: { "content-type": "application/json" } });
    });
    for await (const _t of streamLLM({
      provider: "openai", apiKey: "k", question: "q",
      ctx: { request: { method: "GET", url: "", headers: {}, body: undefined, authType: "none" }, timestamp: 0 },
      system: "Tu es un sous-agent.",
    } as any)) { /* drain */ }
    expect(JSON.parse(bodyCapture.body).system).toBe("Tu es un sous-agent.");
  });
});
