import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SYSTEM_PROMPT,
  PROMPTS,
  parseAIResponse,
  dispatchAIActions,
  callAI,
  callAIText,
} from "@/src/ai/engine";
import type { AIContext, AIAction, AIResponse } from "@/src/ai/engine";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it("contains all action types documented in the prompt", () => {
    const actions = [
      "FILL_REQUEST",
      "ADD_ASSERTIONS",
      "CREATE_VARIABLE",
      "SUGGEST_FIX",
      "GENERATE_DOC",
      "EXPLAIN",
    ];
    for (const action of actions) {
      expect(SYSTEM_PROMPT).toContain(action);
    }
  });

  it("forbids markdown fences in output", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("json");
  });
});

describe("PROMPTS", () => {
  const mockCtx: AIContext = {
    currentRequest: {
      method: "GET",
      url: "https://api.example.com/users",
      headers: {},
      params: {},
    },
    environmentVariables: { API_KEY: "sk-123" },
    collectionHistory: [],
  };

  describe("analyzeResponse", () => {
    it("returns expected prompt when lastResponse is present", () => {
      const ctx = {
        ...mockCtx,
        lastResponse: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { id: 1 },
        },
      };
      const prompt = PROMPTS.analyzeResponse(ctx);
      expect(prompt).toContain("GET");
      expect(prompt).toContain("https://api.example.com/users");
      expect(prompt).toContain("200");
      expect(prompt).toContain("ADD_ASSERTIONS");
    });

    it("handles missing lastResponse", () => {
      const prompt = PROMPTS.analyzeResponse(mockCtx);
      expect(prompt).toContain("no-response");
    });

    it("includes env variables note when none", () => {
      const ctx = { ...mockCtx, environmentVariables: {} };
      const prompt = PROMPTS.analyzeResponse(ctx);
      expect(prompt).toContain("none");
    });
  });

  describe("generateTests", () => {
    it("mentions categories", () => {
      const prompt = PROMPTS.generateTests(mockCtx);
      expect(prompt).toContain("5 categories");
    });
  });

  describe("naturalLanguageToRequest", () => {
    it("includes the description", () => {
      const prompt = PROMPTS.naturalLanguageToRequest("Create a user", mockCtx);
      expect(prompt).toContain("Create a user");
      expect(prompt).toContain("{{API_KEY}}");
    });
  });

  describe("debugError", () => {
    it("includes last status", () => {
      const ctx = {
        ...mockCtx,
        lastResponse: { status: 500, headers: {}, body: { error: "Internal Server Error" } },
      };
      const prompt = PROMPTS.debugError(ctx);
      expect(prompt).toContain("500");
      expect(prompt).toContain("SUGGEST_FIX");
    });
  });

  describe("generateDocs", () => {
    it("lists endpoints", () => {
      const requests = [
        { method: "GET" as const, url: "/api/users", headers: {}, params: {} },
        { method: "POST" as const, url: "/api/users", headers: {}, params: {}, body: {} },
      ];
      const prompt = PROMPTS.generateDocs(requests);
      expect(prompt).toContain("/api/users");
      expect(prompt).toContain("GENERATE_DOC");
    });
  });
});

describe("parseAIResponse", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      summary: "All good",
      actions: [{ type: "EXPLAIN", payload: { message: "Hello" } }],
    });
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("All good");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("EXPLAIN");
  });

  it("strips markdown code fences", () => {
    const raw =
      '```json\n{"summary": "test", "actions": [{"type": "EXPLAIN", "payload": {"message": "ok"}}]}\n```';
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("test");
  });

  it("strips backticks", () => {
    const raw =
      '`{"summary": "test", "actions": [{"type": "EXPLAIN", "payload": {"message": "ok"}}]}`';
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("test");
  });

  it("extracts JSON from surrounding text", () => {
    const raw =
      'Here is the response: {"summary": "test", "actions": [{"type": "EXPLAIN", "payload": {"message": "ok"}}]}';
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("test");
  });

  it("returns fallback for unparseable input", () => {
    const result = parseAIResponse("not json at all");
    expect(result.summary).toBe("The AI response could not be parsed.");
    expect(result.actions[0].type).toBe("EXPLAIN");
  });

  it("returns fallback for empty string", () => {
    const result = parseAIResponse("");
    expect(result.summary).toBe("The AI response could not be parsed.");
  });

  it("rejects invalid structure (missing actions)", () => {
    const raw = JSON.stringify({ summary: "test" });
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("The AI response could not be parsed.");
  });

  it("rejects invalid structure (actions not array)", () => {
    const raw = JSON.stringify({ summary: "test", actions: "not array" });
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("The AI response could not be parsed.");
  });

  it("handles JSON with extra whitespace", () => {
    const raw =
      '  {"summary": "test", "actions": [{"type": "EXPLAIN", "payload": {"message": "ok"}}]}  ';
    const result = parseAIResponse(raw);
    expect(result.summary).toBe("test");
  });
});

describe("dispatchAIActions", () => {
  it("dispatches EXPLAIN action to notify handler", async () => {
    const notify = vi.fn();
    const actions: AIAction[] = [{ type: "EXPLAIN", payload: { message: "Hello world" } }];
    await dispatchAIActions(actions, { notify });
    expect(notify).toHaveBeenCalledWith("Hello world");
  });

  it("dispatches FILL_REQUEST to setRequest handler", async () => {
    const setRequest = vi.fn();
    const actions: AIAction[] = [
      { type: "FILL_REQUEST", payload: { method: "POST", url: "/api/test", reason: "Test" } },
    ];
    await dispatchAIActions(actions, { setRequest });
    expect(setRequest).toHaveBeenCalledWith(
      { method: "POST", url: "/api/test", reason: "Test" },
      "Test",
    );
  });

  it("dispatches ADD_ASSERTIONS to addAssertions handler", async () => {
    const addAssertions = vi.fn();
    const actions: AIAction[] = [
      {
        type: "ADD_ASSERTIONS",
        payload: { assertions: [{ label: "Status 200", code: "expect(res.status).toBe(200)" }] },
      },
    ];
    await dispatchAIActions(actions, { addAssertions });
    expect(addAssertions).toHaveBeenCalled();
    expect(addAssertions.mock.calls[0][0]).toHaveLength(1);
    expect(addAssertions.mock.calls[0][0][0].label).toBe("Status 200");
  });

  it("dispatches ADD_ASSERTIONS with autoApply when allowed", async () => {
    const addAssertions = vi.fn();
    const audit = vi.fn();
    const actions: AIAction[] = [
      {
        type: "ADD_ASSERTIONS",
        payload: {
          assertions: [{ label: "Status 200", code: "expect(res.status).toBe(200)" }],
          autoApply: true,
        },
      },
    ];
    await dispatchAIActions(actions, { addAssertions, audit }, undefined, { allowAutoApply: true });
    expect(addAssertions.mock.calls[0][1]).toBe(true);
    expect(audit).toHaveBeenCalled();
  });

  it("dispatches CREATE_VARIABLE with direct value", async () => {
    const setVariable = vi.fn();
    const actions: AIAction[] = [
      {
        type: "CREATE_VARIABLE",
        payload: { name: "user_id", value: "42", description: "User ID" },
      },
    ];
    await dispatchAIActions(actions, { setVariable });
    expect(setVariable).toHaveBeenCalledWith("user_id", "42", "User ID");
  });

  it("dispatches CREATE_VARIABLE with fromResponsePath", async () => {
    const setVariable = vi.fn();
    const ctx: AIContext = {
      currentRequest: { method: "GET", url: "/api/users", headers: {}, params: {} },
      environmentVariables: {},
      collectionHistory: [],
      lastResponse: { status: 200, headers: {}, body: { data: { id: 99 } } },
    };
    const actions: AIAction[] = [
      {
        type: "CREATE_VARIABLE",
        payload: { name: "user_id", fromResponsePath: "$.data.id" },
      },
    ];
    await dispatchAIActions(actions, { setVariable }, ctx);
    expect(setVariable).toHaveBeenCalledWith("user_id", "99", undefined);
  });

  it("dispatches SUGGEST_FIX with notification", async () => {
    const notify = vi.fn();
    const actions: AIAction[] = [
      {
        type: "SUGGEST_FIX",
        payload: {
          description: "Add auth header",
          patch: { headers: { Authorization: "Bearer token" } },
        },
      },
    ];
    await dispatchAIActions(actions, { notify });
    expect(notify).toHaveBeenCalledWith("Add auth header");
  });

  it("dispatches SUGGEST_FIX with autoApply when allowed", async () => {
    const notify = vi.fn();
    const applyFix = vi.fn();
    const audit = vi.fn();
    const actions: AIAction[] = [
      {
        type: "SUGGEST_FIX",
        payload: {
          description: "Fix auth",
          patch: { headers: { Authorization: "Bearer token" } },
          autoApply: true,
        },
      },
    ];
    await dispatchAIActions(actions, { notify, applyFix, audit }, undefined, {
      allowAutoApply: true,
    });
    expect(applyFix).toHaveBeenCalled();
    expect(audit).toHaveBeenCalled();
  });

  it("dispatches GENERATE_DOC to setDoc handler", async () => {
    const setDoc = vi.fn();
    const actions: AIAction[] = [
      {
        type: "GENERATE_DOC",
        payload: { markdown: "# API Docs", title: "My API" },
      },
    ];
    await dispatchAIActions(actions, { setDoc });
    expect(setDoc).toHaveBeenCalledWith("# API Docs", "My API");
  });

  it("dispatches EXECUTE_REQUEST to executeRequest handler", async () => {
    const setRequest = vi.fn();
    const executeRequest = vi.fn().mockResolvedValue({ status: 200 });
    const audit = vi.fn();
    const actions: AIAction[] = [
      {
        type: "EXECUTE_REQUEST",
        payload: { method: "GET", url: "/api/test", reason: "Test run" },
      },
    ];
    await dispatchAIActions(actions, { setRequest, executeRequest, audit }, undefined, {
      allowAutoApply: true,
    });
    expect(setRequest).toHaveBeenCalled();
    expect(executeRequest).toHaveBeenCalled();
    expect(audit).toHaveBeenCalled();
  });

  it("handles unknown action type gracefully", async () => {
    const notify = vi.fn();
    const actions = [{ type: "UNKNOWN_TYPE", payload: {} }] as unknown as AIAction[];
    await dispatchAIActions(actions, { notify });
    expect(notify).toHaveBeenCalledWith("Unknown action type: UNKNOWN_TYPE");
  });

  it("handles handler errors gracefully", async () => {
    const notify = vi.fn();
    const setRequest = vi.fn().mockRejectedValue(new Error("Handler crashed"));
    const actions: AIAction[] = [{ type: "FILL_REQUEST", payload: { url: "/test" } }];
    await dispatchAIActions(actions, { setRequest, notify });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("FILL_REQUEST handler error"));
  });
});

describe("callAI", () => {
  it("returns error summary when provider requires apiKey but none given", async () => {
    const result = await callAI("test", { provider: "openai", apiKey: "" });
    expect(result.summary).toBe("AI call failed.");
    expect(result.actions[0].type).toBe("EXPLAIN");
  });

  it("returns error for unsupported provider", async () => {
    const result = await callAI("test", { provider: "unknown" as any });
    expect(result.summary).toBe("AI call failed.");
    expect(result.actions[0].type).toBe("EXPLAIN");
  });

  it("parses valid response from proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content:
          '{"summary": "ok", "actions": [{"type": "EXPLAIN", "payload": {"message": "test"}}]}',
      }),
    });
    const result = await callAI("test prompt", { provider: "openai", apiKey: "sk-test" });
    expect(result.summary).toBe("ok");
    expect(result.actions).toHaveLength(1);
  });

  it("handles proxy error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const result = await callAI("test", { provider: "openai", apiKey: "bad-key" });
    expect(result.summary).toBe("AI call failed.");
  });
});

describe("callAIText", () => {
  it("rejects missing apiKey for openai", async () => {
    await expect(callAIText("test", { provider: "openai", apiKey: "" })).rejects.toThrow("apiKey");
  });

  it("rejects missing apiKey for anthropic", async () => {
    await expect(callAIText("test", { provider: "anthropic", apiKey: "" })).rejects.toThrow(
      "apiKey",
    );
  });

  it("rejects unsupported provider", async () => {
    await expect(callAIText("test", { provider: "unknown" as any, apiKey: "x" })).rejects.toThrow(
      "Unsupported provider",
    );
  });

  it("returns content from successful proxy call", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: "Hello from AI" }),
    });
    const result = await callAIText("test", { provider: "openai", apiKey: "sk-test" });
    expect(result).toBe("Hello from AI");
  });

  it("throws on proxy error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Server Error",
    });
    await expect(callAIText("test", { provider: "openai", apiKey: "sk-test" })).rejects.toThrow(
      "Erreur HTTP 500",
    );
  });
});
