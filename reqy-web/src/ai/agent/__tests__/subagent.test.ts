import { describe, it, expect, vi } from "vitest";

vi.mock("@/src/ai/cloud-engine/llm", () => ({
  streamLLM: vi.fn().mockImplementation(async function* () {
    yield { type: "text", value: "Réponse du sous-agent." };
    yield { type: "usage", usage: { inputTokens: 12, outputTokens: 5 } };
  }),
}));

import { runSubAgent, assertDelegationAllowed, MAX_DELEGATE_DEPTH } from "../subagent";

describe("ai-agent subagent", () => {
  it("streams a focused instruction and returns text + usage", async () => {
    const res = await runSubAgent({
      provider: "openai",
      apiKey: "k",
      role: "Tu es un analyste API.",
      instruction: "Analyse ce body.",
      context: "{\"a\":1}",
    });
    expect(res.text).toContain("sous-agent");
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
  });

  it("refuses delegation beyond max depth", async () => {
    expect(MAX_DELEGATE_DEPTH).toBe(1);
    expect(() => assertDelegationAllowed(0)).not.toThrow();
    expect(() => assertDelegationAllowed(1)).toThrow(/Profondeur/);
  });
});
