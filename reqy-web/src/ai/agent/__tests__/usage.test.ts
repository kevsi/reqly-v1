import { describe, it, expect } from "vitest";
import { emptyUsage, addUsage, mergeUsages, formatTokens } from "../usage";

describe("ai-agent usage", () => {
  it("starts empty", () => {
    expect(emptyUsage()).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 });
  });

  it("accumulates a delta and increments calls", () => {
    const u = addUsage(emptyUsage(), { inputTokens: 100, outputTokens: 50 });
    expect(u).toEqual({ inputTokens: 100, outputTokens: 50, calls: 1 });
    expect(addUsage(u, { inputTokens: 30, outputTokens: 10 })).toEqual({ inputTokens: 130, outputTokens: 60, calls: 2 });
  });

  it("merges several usages", () => {
    const merged = mergeUsages([
      { inputTokens: 10, outputTokens: 20, calls: 1 },
      { inputTokens: 30, outputTokens: 5, calls: 2 },
    ]);
    expect(merged).toEqual({ inputTokens: 40, outputTokens: 25, calls: 3 });
  });

  it("formats tokens compactly", () => {
    expect(formatTokens({ inputTokens: 1250, outputTokens: 500, calls: 2 })).toBe("1.3k in / 500 out");
    expect(formatTokens(emptyUsage())).toBe("");
  });
});
