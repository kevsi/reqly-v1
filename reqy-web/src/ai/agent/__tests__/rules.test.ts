import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockStore = new Map<string, unknown>();
vi.mock("@/lib/persistence", () => ({
  persistence: {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: unknown) => { mockStore.set(k, v); return Promise.resolve(); },
  },
}));

import { loadRules, saveRules, buildRulesSystemPrompt } from "../rules";

describe("ai-agent rules", () => {
  beforeEach(() => mockStore.clear());
  afterEach(() => vi.clearAllMocks());

  it("returns null when no rules are saved", () => {
    expect(loadRules("ws-1")).toBeNull();
  });

  it("saves and reloads a rules file per workspace", () => {
    saveRules("ws-1", "Toujours valider les bodies JSON.");
    const loaded = loadRules("ws-1");
    expect(loaded?.content).toBe("Toujours valider les bodies JSON.");
    expect(loadRules("ws-2")).toBeNull();
  });

  it("builds an empty system prompt block when no rules", () => {
    expect(buildRulesSystemPrompt(null)).toBe("");
    expect(buildRulesSystemPrompt({ workspaceId: "w", content: "   ", updatedAt: "" })).toBe("");
  });

  it("wraps non-empty rules in a project-rules block", () => {
    const out = buildRulesSystemPrompt({ workspaceId: "w", content: "Règle 1", updatedAt: "" });
    expect(out).toContain("# Règles du workspace");
    expect(out).toContain("Règle 1");
  });
});
