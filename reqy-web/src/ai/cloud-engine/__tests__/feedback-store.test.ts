import { describe, it, expect, beforeEach } from "vitest";
import {
  rateDiagnostic,
  getRating,
  getAllRatings,
  clearRatings,
  getRatingStats,
} from "@/src/ai/cloud-engine/feedback-store";

// @vitest-environment jsdom

describe("feedback-store", () => {
  beforeEach(() => {
    clearRatings();
  });

  it("returns null for unknown diagnostic", () => {
    expect(getRating("unknown")).toBeNull();
  });

  it("stores and retrieves a thumbs-up rating", () => {
    rateDiagnostic("d1", "up");
    expect(getRating("d1")).toBe("up");
  });

  it("stores and retrieves a thumbs-down rating", () => {
    rateDiagnostic("d2", "down");
    expect(getRating("d2")).toBe("down");
  });

  it("clears rating when set to null", () => {
    rateDiagnostic("d3", "up");
    rateDiagnostic("d3", null);
    expect(getRating("d3")).toBeNull();
  });

  it("overwrites previous rating", () => {
    rateDiagnostic("d4", "up");
    rateDiagnostic("d4", "down");
    expect(getRating("d4")).toBe("down");
  });

  it("getAllRatings returns the full map", () => {
    rateDiagnostic("a", "up");
    rateDiagnostic("b", "down");
    const all = getAllRatings();
    expect(all.a).toBe("up");
    expect(all.b).toBe("down");
    expect(Object.keys(all)).toHaveLength(2);
  });

  it("clearRatings empties the store", () => {
    rateDiagnostic("a", "up");
    rateDiagnostic("b", "down");
    clearRatings();
    expect(getAllRatings()).toEqual({});
  });

  it("getRatingStats computes counts", () => {
    rateDiagnostic("a", "up");
    rateDiagnostic("b", "up");
    rateDiagnostic("c", "down");
    const stats = getRatingStats();
    expect(stats).toEqual({ total: 3, up: 2, down: 1 });
  });
});
