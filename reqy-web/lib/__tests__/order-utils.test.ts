import { describe, it, expect } from "vitest";
import { computeOrder } from "@/lib/types";

describe("computeOrder", () => {
  it("inserts between two existing orders", () => {
    // Between 1000 and 2000 → 1500
    expect(computeOrder(1000, 2000)).toBe(1500);
  });

  it("inserts after last item with no next", () => {
    // After 1000 with no next → (1000 + 1000) / 2 = 1000... wait, computeOrder(1000, null) uses base=2000 as fallback
    // prev=1000, next=2000 → 1500
    const result = computeOrder(1000, null, 3000);
    expect(result).toBeGreaterThan(1000);
  });

  it("inserts before first item with no prev", () => {
    // No prev, next=1000 → prev defaults to 0 → (0 + 1000) / 2 = 500
    expect(computeOrder(null, 1000)).toBe(500);
  });

  it("returns midpoint for first item in empty list", () => {
    // No prev, no next, base=2000 → next defaults to 2000 → (0 + 2000) / 2 = 1000
    expect(computeOrder(null, null, 2000)).toBe(1000);
  });

  it("falls back to base when no prev/next", () => {
    expect(computeOrder(null, null, 5000)).toBe(2500);
  });

  it("never returns duplicate values for sequential inserts", () => {
    const values = new Set<number>();
    let prev: number | null = null;
    for (let i = 0; i < 100; i++) {
      const order = computeOrder(prev, null, i * 2000);
      values.add(order);
      prev = order;
    }
    // All 100 values should be unique
    expect(values.size).toBe(100);
  });

  it("handles fractional gap", () => {
    // Between 1.5 and 1.6 → 1.55
    expect(computeOrder(1.5, 1.6)).toBe(1.55);
  });

  it("handles tight gaps above threshold", () => {
    // 0.01 gap is above the 0.001 threshold, so it averages
    expect(computeOrder(1000, 1010)).toBe(1005);
  });

  it("escapes zero gap by shifting", () => {
    // If next - prev < 0.001, adds 1 to prev
    const result = computeOrder(5, 5); // gap = 0
    expect(result).toBe(6);
  });

  it("escapes near-zero gap by shifting", () => {
    // If next - prev < 0.001, adds 1 to prev
    const result = computeOrder(1.0001, 1.0002); // gap = 0.0001
    expect(result).toBeCloseTo(2.0001, 10);
  });

  it("uses base when only prev is provided", () => {
    // prev=1000, no next, no base → next defaults to 2000 → 1500
    const result = computeOrder(1000, null);
    expect(result).toBeGreaterThan(1000);
  });

  it("handles prev=0 correctly", () => {
    // prev=0, next=1000 → (0 + 1000) / 2 = 500
    expect(computeOrder(0, 1000)).toBe(500);
  });
});
