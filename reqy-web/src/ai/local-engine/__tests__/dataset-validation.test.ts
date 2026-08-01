import { describe, it, expect } from "vitest";
import { analyze } from "@/src/ai/local-engine/analyzer";
import type { RequestContext } from "@/src/ai/types";
import errorDataset from "@/src/ai/__tests__/fixtures/error-dataset.json";

describe("dataset validation", () => {
  it("every fixture produces at least one diagnostic", () => {
    const fixtures = errorDataset as any[];
    let matched = 0;
    const unmatched: string[] = [];
    for (const f of fixtures) {
      const ctx: RequestContext = { ...f.context, timestamp: Date.now() };
      const diags = analyze(ctx);
      if (diags.length > 0) matched++;
      else unmatched.push(f.id);
    }
    // Require >= 85% coverage (target from spec)
    expect(matched / fixtures.length).toBeGreaterThanOrEqual(0.85);
    if (unmatched.length > 0) {
      console.warn(`Unmatched fixtures: ${unmatched.length}`, unmatched.slice(0, 10));
    }
  });

  it("precision: when a fixture has an expected ruleId, analyzer must produce it", () => {
    const fixtures = errorDataset as any[];
    const withExpected = fixtures.filter((f) => f.expected?.ruleId);
    let correct = 0;
    const wrong: Array<{ id: string; expected: string; got: string[] }> = [];
    for (const f of withExpected) {
      const ctx: RequestContext = { ...f.context, timestamp: Date.now() };
      const diags = analyze(ctx);
      const gotIds = diags.map((d) => d.id);
      if (gotIds.includes(f.expected.ruleId)) correct++;
      else wrong.push({ id: f.id, expected: f.expected.ruleId, got: gotIds });
    }
    // Target: > 90% precision
    expect(correct / withExpected.length).toBeGreaterThanOrEqual(0.9);
    if (wrong.length > 0) {
      console.warn(`Mismatched fixtures: ${wrong.length}`, wrong.slice(0, 10));
    }
  });
});
