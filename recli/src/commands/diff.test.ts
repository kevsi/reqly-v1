import { describe, expect, it } from "vitest";
import { computeDiff, findDuplicateNames } from "./diff.js";
import type { RunResult } from "../types.js";

function result(name: string, url: string, status: number, body?: string): RunResult {
  return {
    name,
    method: "GET",
    url,
    status,
    statusText: "",
    durationMs: 100,
    size: 0,
    passed: status < 400,
    body,
    timestamp: 0,
  };
}

describe("computeDiff", () => {
  it("matches by name regardless of order", () => {
    const before = [result("A", "/a", 200), result("B", "/b", 200)];
    const after = [result("B", "/b", 200), result("A", "/a", 201)];
    const diffs = computeDiff(before, after);
    expect(diffs).toHaveLength(2);
    const a = diffs.find((d) => d.name === "A")!;
    expect(a.statusChanged).toBe(true);
    expect(a.oldStatus).toBe(200);
    expect(a.newStatus).toBe(201);
  });

  it("matches duplicate names in FIFO order instead of dropping them", () => {
    const before = [result("A", "/a/1", 200), result("A", "/a/2", 200)];
    const after = [result("A", "/a/x", 500), result("A", "/a/y", 200)];
    const diffs = computeDiff(before, after);
    expect(diffs).toHaveLength(2);
    // First before-entry pairs with first after-entry, second with second.
    expect(diffs[0]!.statusChanged).toBe(true);
    expect(diffs[0]!.newStatus).toBe(500);
    expect(diffs[1]!.statusChanged).toBe(false);
    expect(diffs[1]!.newStatus).toBe(200);
  });

  it("pairs reordered duplicates by URL to avoid spurious changes", () => {
    const before = [result("A", "/a/1", 200), result("A", "/a/2", 200)];
    const after = [result("A", "/a/2", 200), result("A", "/a/1", 200)];
    const diffs = computeDiff(before, after);
    expect(diffs).toHaveLength(2);
    expect(diffs.every((d) => !d.statusChanged && !d.bodyChanged)).toBe(true);
  });

  it("reports entries present only in before as removed", () => {
    const before = [result("A", "/a", 200), result("Gone", "/gone", 200)];
    const after = [result("A", "/a", 200)];
    const diffs = computeDiff(before, after);
    const gone = diffs.find((d) => d.name === "Gone")!;
    expect(gone.statusChanged).toBe(true);
    expect(gone.newStatus).toBe(0);
    expect(gone.passedAfter).toBe(false);
  });

  it("reports entries present only in after as added", () => {
    const before = [result("A", "/a", 200)];
    const after = [result("A", "/a", 200), result("New", "/new", 201)];
    const diffs = computeDiff(before, after);
    const added = diffs.find((d) => d.name === "New")!;
    expect(added.statusChanged).toBe(true);
    expect(added.oldStatus).toBe(0);
    expect(added.newStatus).toBe(201);
  });
});

describe("findDuplicateNames", () => {
  it("returns names that occur more than once", () => {
    const results = [result("A", "/a", 200), result("B", "/b", 200), result("A", "/a2", 200)];
    expect(findDuplicateNames(results)).toEqual(["A"]);
  });

  it("returns an empty array when every name is unique", () => {
    expect(findDuplicateNames([result("A", "/a", 200), result("B", "/b", 200)])).toEqual([]);
  });
});
