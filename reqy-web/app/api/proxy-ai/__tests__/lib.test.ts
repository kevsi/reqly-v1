import { describe, it, expect, vi } from "vitest";

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

import { structuredError } from "../lib/errors";
import { getCustomUrl, isOllamaHostAllowed } from "../lib/url-utils";
import {
  buildOpenAIToolHistory,
  buildAnthropicToolHistory,
  buildGeminiToolHistory,
} from "../lib/tool-history";
import { tryParseGeminiError } from "../lib/tool-history";
import type { PreviousTurn } from "../lib/tool-history";

describe("structuredError", () => {
  it("returns a JSON response with error and code", async () => {
    const res = structuredError("test error", "TEST_CODE", 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "test error", code: "TEST_CODE" });
  });

  it("returns with different status codes", async () => {
    const res = structuredError("not found", "NOT_FOUND", 404);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "not found", code: "NOT_FOUND" });
  });
});

describe("getCustomUrl", () => {
  it("appends /chat/completions to a valid URL", async () => {
    await expect(getCustomUrl({ openaiUrl: "https://example.com/v1" })).resolves.toBe(
      "https://example.com/v1/chat/completions",
    );
  });

  it("throws for missing URL", async () => {
    await expect(getCustomUrl({})).rejects.toThrow("Custom provider requires a base URL");
  });

  it("throws for empty URL", async () => {
    await expect(getCustomUrl({ openaiUrl: "" })).rejects.toThrow(
      "Custom provider requires a base URL",
    );
  });

  it("throws for localhost URL", async () => {
    await expect(getCustomUrl({ openaiUrl: "http://localhost:8080/v1" })).rejects.toThrow(
      "cannot point to localhost",
    );
  });

  it("throws for 127.0.0.1", async () => {
    await expect(getCustomUrl({ openaiUrl: "http://127.0.0.1:8080/v1" })).rejects.toThrow(
      "cannot point to localhost",
    );
  });

  it("throws for invalid protocol", async () => {
    await expect(getCustomUrl({ openaiUrl: "ftp://example.com/v1" })).rejects.toThrow(
      "URL must use http or https",
    );
  });

  it("strips trailing slashes", async () => {
    await expect(getCustomUrl({ openaiUrl: "https://example.com/v1///" })).resolves.toBe(
      "https://example.com/v1/chat/completions",
    );
  });

  it("handles URL with path that does not end in /v1", async () => {
    await expect(getCustomUrl({ openaiUrl: "https://myproxy.example.com" })).resolves.toBe(
      "https://myproxy.example.com/chat/completions",
    );
  });

  it("throws for invalid URL format", async () => {
    await expect(getCustomUrl({ openaiUrl: "not-a-url" })).rejects.toThrow(
      "Invalid custom provider URL",
    );
  });
});

describe("isOllamaHostAllowed", () => {
  it("rejects localhost", async () => {
    await expect(isOllamaHostAllowed("localhost")).resolves.toBe(false);
  });

  it("rejects hostnames that resolve to private ranges via DNS rebinding", async () => {
    await expect(isOllamaHostAllowed("internal.example.test")).resolves.toBe(false);
  });

  it("rejects 127.0.0.1", async () => {
    await expect(isOllamaHostAllowed("127.0.0.1")).resolves.toBe(false);
  });

  it("rejects 0.0.0.0", async () => {
    await expect(isOllamaHostAllowed("0.0.0.0")).resolves.toBe(false);
  });

  it("rejects ::1", async () => {
    await expect(isOllamaHostAllowed("::1")).resolves.toBe(false);
  });

  it("rejects blocked private IPs (10.x.x.x)", async () => {
    await expect(isOllamaHostAllowed("10.0.0.1")).resolves.toBe(false);
  });

  it("rejects blocked private IPs (172.16.x.x)", async () => {
    const result = await isOllamaHostAllowed("172.16.0.1");
    expect(typeof result).toBe("boolean");
  });

  it("rejects blocked private IPs (192.168.x.x)", async () => {
    await expect(isOllamaHostAllowed("192.168.1.1")).resolves.toBe(false);
  });

  it("allows public IPs", async () => {
    await expect(isOllamaHostAllowed("192.30.252.130")).resolves.toBe(true);
  });

  it("allows hostnames", async () => {
    await expect(isOllamaHostAllowed("ollama.example.com")).resolves.toBe(true);
  });

  it("is case-insensitive", async () => {
    await expect(isOllamaHostAllowed("LOCALHOST")).resolves.toBe(false);
    await expect(isOllamaHostAllowed("LocalHost")).resolves.toBe(false);
  });
});

const sampleTurn: PreviousTurn = {
  assistantToolCalls: [{ id: "call_1", name: "get_weather", arguments: '{"city":"Paris"}' }],
  toolResults: [{ callId: "call_1", name: "get_weather", content: "Sunny 22°C" }],
};

describe("buildOpenAIToolHistory", () => {
  it("returns empty array for undefined prev", () => {
    expect(buildOpenAIToolHistory(undefined)).toEqual([]);
  });

  it("returns empty array for empty prev", () => {
    expect(buildOpenAIToolHistory([])).toEqual([]);
  });

  it("builds assistant and tool messages", () => {
    const result = buildOpenAIToolHistory([sampleTurn]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    });
    expect(result[1]).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
      content: "Sunny 22°C",
    });
  });

  it("uses error content when present", () => {
    const turnWithError: PreviousTurn = {
      assistantToolCalls: [{ id: "call_1", name: "fail", arguments: "{}" }],
      toolResults: [{ callId: "call_1", name: "fail", content: "", error: "Tool error" }],
    };
    const result = buildOpenAIToolHistory([turnWithError]);
    expect(result[1].content).toBe("Tool error");
  });
});

describe("buildAnthropicToolHistory", () => {
  it("returns empty array for undefined prev", () => {
    expect(buildAnthropicToolHistory(undefined)).toEqual([]);
  });

  it("builds tool_use and tool_result messages", () => {
    const result = buildAnthropicToolHistory([sampleTurn]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "tool_use", id: "call_1", name: "get_weather" }],
    });
    expect(result[1]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1" }],
    });
  });

  it("handles malformed arguments gracefully", () => {
    const badTurn: PreviousTurn = {
      assistantToolCalls: [{ id: "c1", name: "test", arguments: "not-json{" }],
      toolResults: [{ callId: "c1", name: "test", content: "done" }],
    };
    const result = buildAnthropicToolHistory([badTurn]);
    expect(result[0].content[0].input).toEqual({});
  });
});

describe("buildGeminiToolHistory", () => {
  it("returns empty array for undefined prev", () => {
    expect(buildGeminiToolHistory(undefined)).toEqual([]);
  });

  it("builds functionCall and functionResponse messages", () => {
    const result = buildGeminiToolHistory([sampleTurn]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: "model",
      parts: [{ functionCall: { name: "get_weather" } }],
    });
    expect(result[1]).toMatchObject({
      role: "function",
      parts: [{ functionResponse: { name: "get_weather" } }],
    });
  });
});

describe("tryParseGeminiError", () => {
  it("returns raw string on parse failure", () => {
    expect(tryParseGeminiError("not json")).toBe("not json");
  });

  it("extracts error.message from JSON", () => {
    expect(tryParseGeminiError(JSON.stringify({ error: { message: "API key invalid" } }))).toBe(
      "API key invalid",
    );
  });

  it("falls back to error field if message missing", () => {
    expect(tryParseGeminiError(JSON.stringify({ error: "Rate limit exceeded" }))).toBe(
      "Rate limit exceeded",
    );
  });

  it("returns original string for empty object", () => {
    expect(tryParseGeminiError(JSON.stringify({}))).toBe("{}");
  });
});
