import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

// Runtime surface
import {
  parseAIResponse,
  dispatchAIActions,
  PROMPTS,
  SYSTEM_PROMPT,
} from "@/src/ai";

// Type-only imports — these must compile and reference real exports.
import type {
  AIProvider,
  AIResponse,
  AIAction,
  AIContext,
  CurrentRequest,
  LastResponse,
  KeyValue,
  TestAssertion,
} from "@/src/ai";

import * as actions from "@/src/ai/cloud-engine/actions";

describe("@/src/ai public API surface", () => {
  it("re-exports every runtime function declared on cloud-engine/actions", () => {
    expect(typeof parseAIResponse).toBe("function");
    expect(typeof dispatchAIActions).toBe("function");
    expect(typeof PROMPTS).toBe("object");
    expect(typeof SYSTEM_PROMPT).toBe("string");
  });

  it("shares identity with the underlying module (no re-binding)", () => {
    // Re-exports must be the same references, not copies — otherwise
    // consumers that depend on identity (e.g. instanceof, memoization)
    // would break.
    expect(parseAIResponse).toBe(actions.parseAIResponse);
    expect(dispatchAIActions).toBe(actions.dispatchAIActions);
    expect(PROMPTS).toBe(actions.PROMPTS);
    // Le barrel public garde le nom historique SYSTEM_PROMPT via un alias vers
    // ACTIONS_SYSTEM_PROMPT (distinct du persona ReqlyAI interne).
    expect(SYSTEM_PROMPT).toBe(actions.ACTIONS_SYSTEM_PROMPT);
  });

  it("does not leak implementation-internal action payload types as values", async () => {
    // The re-exports list is intentionally limited to runtime + union types.
    // FillRequestAction / AddAssertionsAction / etc. should only be reachable
    // via the AIAction discriminated union, and individual action payload
    // shapes must not appear as runtime values.
    const mod = await import("@/src/ai");
    const runtimeKeys = Object.keys(mod).sort();
    // `export type` is erased at compile time, so the runtime surface is
    // only the four values/functions listed below.
    expect(runtimeKeys).toEqual(
      ["PROMPTS", "SYSTEM_PROMPT", "dispatchAIActions", "parseAIResponse"].sort(),
    );
    // None of the internal payload-type names should be re-exported as values.
    for (const internal of [
      "FillRequestAction",
      "AddAssertionsAction",
      "CreateVariableAction",
      "SuggestFixAction",
      "GenerateDocAction",
      "ExplainAction",
      "ExecuteRequestAction",
      "RunBatchAction",
      "HTTPMethod",
      "callAI",
      "callAIText",
    ]) {
      expect(runtimeKeys).not.toContain(internal);
    }
  });
});

describe("@/src/ai re-exports work end-to-end", () => {
  it("SYSTEM_PROMPT documents the public action vocabulary", () => {
    for (const action of [
      "FILL_REQUEST",
      "ADD_ASSERTIONS",
      "CREATE_VARIABLE",
      "SUGGEST_FIX",
      "GENERATE_DOC",
      "EXPLAIN",
    ]) {
      expect(SYSTEM_PROMPT).toContain(action);
    }
  });

  it("PROMPTS helpers accept an AIContext and return a string", () => {
    const ctx: AIContext = {
      currentRequest: {
        method: "GET",
        url: "https://api.example.com/users",
        headers: {},
        params: {},
      },
      environmentVariables: { API_KEY: "sk-test" },
      collectionHistory: [],
    };
    expect(typeof PROMPTS.analyzeResponse(ctx)).toBe("string");
    expect(typeof PROMPTS.generateTests(ctx)).toBe("string");
    expect(typeof PROMPTS.naturalLanguageToRequest("Create a user", ctx)).toBe("string");
    expect(typeof PROMPTS.debugError(ctx)).toBe("string");
    expect(typeof PROMPTS.generateDocs([])).toBe("string");
  });

  it("parseAIResponse handles valid JSON via the re-export", () => {
    const raw = JSON.stringify({
      summary: "ok",
      actions: [{ type: "EXPLAIN", payload: { message: "hi" } }],
    });
    const result: AIResponse = parseAIResponse(raw);
    expect(result.summary).toBe("ok");
    const [action] = result.actions;
    expect(action?.type).toBe("EXPLAIN");
  });

  it("dispatchAIActions routes EXPLAIN through the notify handler", async () => {
    const notify = vi.fn();
    const actions: AIAction[] = [{ type: "EXPLAIN", payload: { message: "hello via re-export" } }];
    await dispatchAIActions(actions, { notify });
    expect(notify).toHaveBeenCalledWith("hello via re-export");
  });
});

describe("@/src/ai type surface is usable", () => {
  // These assignments only need to type-check; they exercise the re-exported
  // type aliases at the consumer call-site.
  it("accepts values matching the re-exported type aliases", () => {
    const provider: AIProvider = "openai";
    const headers: KeyValue = { Authorization: "Bearer x" };
    const assertion: TestAssertion = {
      label: "status",
      code: "expect(r.status).toBe(200);",
    };
    const request: CurrentRequest = {
      method: "GET",
      url: "https://example.com",
      headers,
      params: {},
    };
    const response: LastResponse = { status: 200, headers };
    const ctx: AIContext = {
      currentRequest: request,
      lastResponse: response,
      environmentVariables: {},
      collectionHistory: [],
    };
    const action: AIAction = {
      type: "EXPLAIN",
      payload: { message: "typed" },
    };
    const parsed: AIResponse = {
      summary: "x",
      actions: [action],
    };

    expect(provider).toBe("openai");
    expect(assertion.label).toBe("status");
    expect(ctx.lastResponse?.status).toBe(200);
    expect(parsed.actions).toHaveLength(1);
  });
});
