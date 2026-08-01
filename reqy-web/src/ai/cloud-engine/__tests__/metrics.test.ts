import { describe, it, expect, beforeEach } from "vitest";
import {
  recordLatency,
  getLatencyStats,
  resetLatency,
  resetAllLatency,
  timeAsync,
} from "@/src/ai/cloud-engine/metrics";

describe("recordLatency / getLatencyStats", () => {
  beforeEach(() => {
    resetAllLatency();
  });

  it("returns null when no samples recorded", () => {
    expect(getLatencyStats("empty")).toBeNull();
  });

  it("computes min/max/avg/count correctly", () => {
    [10, 20, 30, 40, 50].forEach((v) => recordLatency("basic", v));
    const stats = getLatencyStats("basic");
    expect(stats?.count).toBe(5);
    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(50);
    expect(stats?.avg).toBe(30);
  });

  it("computes percentiles", () => {
    for (let i = 1; i <= 100; i++) recordLatency("pct", i);
    const stats = getLatencyStats("pct");
    expect(stats?.count).toBe(100);
    // Nearest-rank: p50 of 1..100 = sorted[Math.floor(0.5*100)] = sorted[50] = 51
    expect(stats?.p50).toBe(51);
    // p95 = sorted[Math.floor(0.95*100)] = sorted[95] = 96
    expect(stats?.p95).toBe(96);
    // p99 = sorted[Math.floor(0.99*100)] = sorted[99] = 100
    expect(stats?.p99).toBe(100);
  });

  it("ignores invalid samples (NaN, negative)", () => {
    recordLatency("invalid", NaN);
    recordLatency("invalid", -5);
    recordLatency("invalid", 100);
    const stats = getLatencyStats("invalid");
    expect(stats?.count).toBe(1);
    expect(stats?.min).toBe(100);
  });

  it("ring buffer caps at capacity", () => {
    const capacity = 10;
    for (let i = 0; i < 25; i++) recordLatency("cap", i, { capacity });
    const stats = getLatencyStats("cap");
    expect(stats?.count).toBe(10);
    // Should keep only the last 10 samples (15..24)
    expect(stats?.min).toBe(15);
    expect(stats?.max).toBe(24);
  });

  it("isolates stats between labels", () => {
    recordLatency("a", 1);
    recordLatency("b", 100);
    expect(getLatencyStats("a")?.count).toBe(1);
    expect(getLatencyStats("b")?.count).toBe(1);
    expect(getLatencyStats("a")?.max).toBe(1);
    expect(getLatencyStats("b")?.max).toBe(100);
  });

  it("resetLatency clears a single label", () => {
    recordLatency("a", 1);
    recordLatency("b", 1);
    resetLatency("a");
    expect(getLatencyStats("a")).toBeNull();
    expect(getLatencyStats("b")).not.toBeNull();
  });
});

describe("timeAsync", () => {
  beforeEach(() => resetAllLatency());

  it("records elapsed time of the wrapped async function", async () => {
    await timeAsync("async-op", async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const stats = getLatencyStats("async-op");
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(1);
    expect(stats!.min).toBeGreaterThanOrEqual(25);
  });

  it("records time even when function throws", async () => {
    await expect(
      timeAsync("fail", async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const stats = getLatencyStats("fail");
    expect(stats?.count).toBe(1);
  });
});
