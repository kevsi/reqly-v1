import { describe, it, expect } from "vitest";
import { extractCitations, groupCitationsByFamily, type Citation } from "@/src/ai/cloud-engine/citations";

describe("extractCitations", () => {
  it("returns empty for empty input", () => {
    expect(extractCitations([])).toEqual([]);
  });

  it("deduplicates by source, keeping highest score", () => {
    const out = extractCitations([
      { source: "rfc-9110", content: "Low score chunk", score: 0.5 },
      { source: "rfc-9110", content: "High score chunk", score: 0.9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("rfc-9110");
    expect(out[0].snippet).toContain("High score");
  });

  it("sorts by score descending", () => {
    const out = extractCitations([
      { source: "a", content: "First source", score: 0.3 },
      { source: "b", content: "Second source", score: 0.8 },
      { source: "c", content: "Third source", score: 0.5 },
    ]);
    expect(out.map((c) => c.source)).toEqual(["b", "c", "a"]);
  });

  it("caps at MAX_CITATIONS (5)", () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      source: `src-${i}`,
      content: `Content for source ${i}`,
      score: 0.9 - i * 0.01,
    }));
    expect(extractCitations(chunks)).toHaveLength(5);
  });

  it("extracts first sentence as snippet", () => {
    const out = extractCitations([
      { source: "x", content: "First sentence here. Second sentence continues after period." },
    ]);
    expect(out[0].snippet).toBe("First sentence here.");
  });

  it("truncates long content without sentence boundary", () => {
    const longContent = "a".repeat(500);
    const out = extractCitations([{ source: "x", content: longContent }]);
    expect(out[0].snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_LEN);
  });

  it("preserves URL from metadata", () => {
    const out = extractCitations([
      {
        source: "rfc",
        content: "Some text",
        metadata: { url: "https://www.rfc-editor.org/rfc/rfc9110" },
      },
    ]);
    expect(out[0].url).toBe("https://www.rfc-editor.org/rfc/rfc9110");
  });

  it("pretty-prints RFC source as 'RFC 9110'", () => {
    const out = extractCitations([{ source: "rfc-9110", content: "text" }]);
    expect(out[0].label).toBe("RFC 9110");
  });
});

const MAX_SNIPPET_LEN = 121; // 120 chars + ellipsis

describe("groupCitationsByFamily", () => {
  it("groups by source prefix", () => {
    const citations: Citation[] = [
      { source: "rfc-6749", label: "RFC 6749", snippet: "" },
      { source: "rfc-7519", label: "RFC 7519", snippet: "" },
      { source: "mdn-http", label: "MDN HTTP", snippet: "" },
    ];
    const groups = groupCitationsByFamily(citations);
    expect(Object.keys(groups).sort()).toEqual(["mdn", "rfc"]);
    expect(groups.rfc).toHaveLength(2);
  });
});
