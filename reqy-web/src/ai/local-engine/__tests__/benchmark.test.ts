import { describe, it, expect } from "vitest";
import { analyze } from "@/src/ai/local-engine/analyzer";
import type { RequestContext } from "@/src/ai/types";
import errorDataset from "@/src/ai/__tests__/fixtures/error-dataset.json";

describe("performance benchmark", () => {
  it("P95 latency < 50ms over 1000 invocations", () => {
    const fixtures = (errorDataset as any[]).slice(0, 50);
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const f = fixtures[i % fixtures.length];
      const ctx: RequestContext = { ...f.context, timestamp: Date.now() };
      const start = performance.now();
      analyze(ctx);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.log(`P50: ${samples[Math.floor(samples.length * 0.5)].toFixed(2)}ms, P95: ${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThan(50);
  });
});
