import { describe, it, expect } from "vitest";
import { computeLineDiff, MAX_DIFF_LINES, type DiffLine, type DiffResult } from "../diff-viewer";

/**
 * Reference implementation of the ORIGINAL (pre-PERF-1) algorithm: full
 * (m+1)×(n+1) LCS matrix over the whole inputs, no prefix/suffix trimming.
 * Used to prove the trimmed version stays equivalent on small inputs.
 */
function legacyComputeLineDiff(leftRaw: string, rightRaw: string): DiffResult {
  const leftLines = leftRaw.split("\n");
  const rightLines = rightRaw.split("\n");

  const m = leftLines.length;
  const n = rightLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const tempLines: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      tempLines.push({ type: "unchanged", content: leftLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempLines.push({ type: "added", content: rightLines[j - 1] });
      j--;
    } else {
      tempLines.push({ type: "removed", content: leftLines[i - 1] });
      i--;
    }
  }

  const diffLines: DiffLine[] = [];
  for (let k = tempLines.length - 1; k >= 0; k--) {
    diffLines.push(tempLines[k]);
  }

  return {
    lines: diffLines,
    leftLines: leftLines.length,
    rightLines: rightLines.length,
    addedLines: diffLines.filter((l) => l.type === "added").length,
    removedLines: diffLines.filter((l) => l.type === "removed").length,
  };
}

/** Deterministic small-case generator (seeded LCG) for equivalence checks. */
function pseudoRandomCases(count: number): Array<[string[], string[]]> {
  let seed = 42;
  const rand = (max: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % max;
  };

  const cases: Array<[string[], string[]]> = [];
  for (let c = 0; c < count; c++) {
    const alphabet = ["a", "b", "c", "d"];
    const lenL = rand(8);
    const lenR = rand(8);
    const left = Array.from({ length: lenL }, () => alphabet[rand(alphabet.length)]);
    const right = Array.from({ length: lenR }, () => alphabet[rand(alphabet.length)]);
    cases.push([left, right]);
  }
  return cases;
}

describe("computeLineDiff (PERF-1)", () => {
  it("returns all-unchanged lines for identical inputs", () => {
    const result = computeLineDiff("line a\nline b\nline c", "line a\nline b\nline c");
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((l) => l.type === "unchanged")).toBe(true);
    expect(result.addedLines).toBe(0);
    expect(result.removedLines).toBe(0);
    expect(result.leftLines).toBe(3);
    expect(result.rightLines).toBe(3);
  });

  it("matches legacy behavior on canonical small edits", () => {
    // Pure insertion at the end
    expect(computeLineDiff("a\nb", "a\nb\nc")).toEqual({
      lines: [
        { type: "unchanged", content: "a" },
        { type: "unchanged", content: "b" },
        { type: "added", content: "c" },
      ],
      leftLines: 2,
      rightLines: 3,
      addedLines: 1,
      removedLines: 0,
    });

    // Pure deletion in the middle
    expect(computeLineDiff("x\nold\ny", "x\ny")).toEqual({
      lines: [
        { type: "unchanged", content: "x" },
        { type: "removed", content: "old" },
        { type: "unchanged", content: "y" },
      ],
      leftLines: 3,
      rightLines: 2,
      addedLines: 0,
      removedLines: 1,
    });

    // Replacement surrounded by common prefix AND suffix
    expect(computeLineDiff("x\nold\ny", "x\nnew\ny")).toEqual({
      lines: [
        { type: "unchanged", content: "x" },
        { type: "removed", content: "old" },
        { type: "added", content: "new" },
        { type: "unchanged", content: "y" },
      ],
      leftLines: 3,
      rightLines: 3,
      addedLines: 1,
      removedLines: 1,
    });

    // Empty string = single empty line replaced by content
    expect(computeLineDiff("", "a")).toEqual({
      lines: [
        { type: "removed", content: "" },
        { type: "added", content: "a" },
      ],
      leftLines: 1,
      rightLines: 1,
      addedLines: 1,
      removedLines: 1,
    });
  });

  it("is equivalent to the untrimmed legacy algorithm on random small inputs", () => {
    for (const [leftSrc, rightSrc] of pseudoRandomCases(200)) {
      const leftText = leftSrc.join("\n");
      const rightText = rightSrc.join("\n");
      // computeLineDiff operates on the joined strings, so reconstruct from
      // those (an empty array joins to "" = a single empty line).
      const left = leftText.split("\n");
      const right = rightText.split("\n");

      const got = computeLineDiff(leftText, rightText);
      const legacy = legacyComputeLineDiff(leftText, rightText);

      // Same diff size and same per-type counts as the legacy LCS.
      expect(got.lines.length).toBe(legacy.lines.length);
      expect(got.addedLines).toBe(legacy.addedLines);
      expect(got.removedLines).toBe(legacy.removedLines);

      // The diff must reconstruct both inputs: unchanged+removed → left,
      // unchanged+added → right.
      expect(got.lines.filter((l) => l.type !== "added").map((l) => l.content)).toEqual(left);
      expect(got.lines.filter((l) => l.type !== "removed").map((l) => l.content)).toEqual(right);
    }
  });

  it("caps huge diffs to bounded output with omitted-line placeholders", () => {
    const midCount = MAX_DIFF_LINES + 500;
    const prefix = Array.from({ length: 30 }, (_, k) => `prefix-${k}`);
    const suffix = Array.from({ length: 30 }, (_, k) => `suffix-${k}`);
    const left = [...prefix, ...Array.from({ length: midCount }, (_, k) => `L-${k}`), ...suffix];
    const right = [...prefix, ...Array.from({ length: midCount }, (_, k) => `R-${k}`), ...suffix];

    const result = computeLineDiff(left.join("\n"), right.join("\n"));

    // Output stays bounded — no multi-thousand-line blowup.
    expect(result.lines.length).toBeLessThan(MAX_DIFF_LINES);
    expect(result.lines.length).toBe(prefix.length + suffix.length + 2);

    // Prefix/suffix blocks are preserved verbatim as 'same' lines.
    result.lines.slice(0, prefix.length).forEach((l, k) => {
      expect(l.type).toBe("unchanged");
      expect(l.content).toBe(prefix[k]);
    });
    result.lines.slice(-suffix.length).forEach((l, k) => {
      expect(l.type).toBe("unchanged");
      expect(l.content).toBe(suffix[k]);
    });

    // Middle collapsed into one removed + one added pair annotated with counts.
    const removedBlock = result.lines.find((l) => l.type === "removed");
    const addedBlock = result.lines.find((l) => l.type === "added");
    expect(removedBlock?.content).toContain(`… ${midCount} lignes omises …`);
    expect(addedBlock?.content).toContain(`… ${midCount} lignes omises …`);
    expect(result.leftLines).toBe(left.length);
    expect(result.rightLines).toBe(right.length);
  });

  it("handles huge identical inputs without allocating an LCS matrix", () => {
    const huge = Array.from({ length: MAX_DIFF_LINES * 5 }, (_, k) => `same-${k}`);
    const result = computeLineDiff(huge.join("\n"), huge.join("\n"));
    expect(result.lines).toHaveLength(huge.length);
    expect(result.lines.every((l) => l.type === "unchanged")).toBe(true);
  });
});
