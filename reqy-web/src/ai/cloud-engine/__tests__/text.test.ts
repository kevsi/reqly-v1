import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LLMToken } from "@/src/ai/cloud-engine/llm";
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

// Mock streamLLM to yield a controlled token stream.
// `vi.hoisted` : vi.mock est hoisté par Vitest au-dessus des imports, donc la
// factory ne peut référencer que des variables initialisées au hoisting.
const { streamLLMMock } = vi.hoisted(() => ({ streamLLMMock: vi.fn() }));
vi.mock("@/src/ai/cloud-engine/llm", () => ({
  streamLLM: streamLLMMock,
}));

import { callAITextViaStream, type CallAITextViaStreamOptions } from "@/src/ai/cloud-engine/text";

function asyncTokens(tokens: LLMToken[]): AsyncIterable<LLMToken> {
  return (async function* () {
    for (const t of tokens) yield t;
  })();
}

describe("callAITextViaStream", () => {
  beforeEach(() => {
    streamLLMMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accumulates text tokens into a single string, ignoring usage and tool_calls", async () => {
    streamLLMMock.mockReturnValue(
      asyncTokens([
        { type: "text", value: "Hello" },
        { type: "text", value: " " },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
        { type: "text", value: "world" },
      ]),
    );

    const out = await callAITextViaStream({
      provider: "openai",
      apiKey: "sk-test",
      question: "Salut",
      ctx: baseCtx,
    });

    expect(out).toBe("Hello world");
    // L'adaptateur ne demande ni tools ni multi-turn.
    expect(streamLLMMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        apiKey: "sk-test",
        question: "Salut",
        ctx: baseCtx,
      }),
    );
  });

  it("returns an empty string when the stream yields no text", async () => {
    streamLLMMock.mockReturnValue(
      asyncTokens([{ type: "usage", usage: { inputTokens: 3, outputTokens: 0 } }]),
    );

    const out = await callAITextViaStream({
      provider: "anthropic",
      apiKey: "sk-ant",
      question: "?",
      ctx: baseCtx,
    });

    expect(out).toBe("");
  });

  it("propagates provider errors (does not swallow them)", async () => {
    streamLLMMock.mockImplementation(async function* () {
      throw new Error("Bad API key");
    });

    await expect(
      callAITextViaStream({
        provider: "openai",
        apiKey: "sk-bad",
        question: "test",
        ctx: baseCtx,
      }),
    ).rejects.toThrow("Bad API key");
  });

  it("forwards the abort signal to streamLLM", async () => {
    const controller = new AbortController();
    streamLLMMock.mockReturnValue(asyncTokens([]));

    await callAITextViaStream({
      provider: "openai",
      apiKey: "sk-test",
      question: "x",
      ctx: baseCtx,
      signal: controller.signal,
    });

    expect(streamLLMMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("passes rawMessage verbatim to streamLLM (no context wrapper)", async () => {
    streamLLMMock.mockReturnValue(asyncTokens([{ type: "text", value: "Réponse" }]));

    const out = await callAITextViaStream({
      provider: "openai",
      apiKey: "sk-test",
      system: "Sys custom",
      rawMessage: "Ma question brute",
    });

    expect(out).toBe("Réponse");
    expect(streamLLMMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMessage: "Ma question brute",
        question: "Ma question brute",
        system: "Sys custom",
        // ctx est un contexte vide déduit (jamais le wrapper buildUserPrompt).
        ctx: expect.any(Object),
      }),
    );
  });

  it("throws when neither rawMessage nor question is provided", async () => {
    await expect(
      callAITextViaStream({
        provider: "openai",
        apiKey: "sk-test",
      } as CallAITextViaStreamOptions),
    ).rejects.toThrow("rawMessage ou question requis");
  });
});
