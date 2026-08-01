import { describe, it, expect } from "vitest";
import {
  buildCollectionDocsPrompt,
  safeHeaders,
  isValidDocsOutput,
  type EndpointSummary,
} from "@/src/ai/cloud-engine/docs-generator";

describe("safeHeaders", () => {
  it("strips Authorization", () => {
    expect(safeHeaders({ Authorization: "Bearer x", Accept: "application/json" })).toEqual({
      Accept: "application/json",
    });
  });
  it("strips multiple secret keys", () => {
    expect(
      safeHeaders({
        "X-API-Key": "abc",
        Cookie: "session=1",
        "X-Custom": "y",
      })
    ).toEqual({ "X-Custom": "y" });
  });
  it("returns empty for undefined", () => {
    expect(safeHeaders(undefined)).toEqual({});
  });
});

describe("buildCollectionDocsPrompt", () => {
  const endpoints: EndpointSummary[] = [
    { method: "POST", url: "https://api.example.com/users", description: "Create a user" },
    {
      method: "GET",
      url: "https://api.example.com/users/:id",
      headers: { Accept: "application/json" },
      responseShape: "{ id: string, name: string }",
    },
  ];

  it("includes title and audience", () => {
    const p = buildCollectionDocsPrompt(endpoints, { title: "My API", audience: "frontend devs" });
    expect(p).toContain("My API");
    expect(p).toContain("frontend devs");
  });

  it("lists endpoints with method + URL", () => {
    const p = buildCollectionDocsPrompt(endpoints);
    expect(p).toContain("POST https://api.example.com/users");
    expect(p).toContain("GET https://api.example.com/users/:id");
  });

  it("includes description when present", () => {
    const p = buildCollectionDocsPrompt(endpoints);
    expect(p).toContain("Create a user");
  });

  it("filters auth headers", () => {
    const p = buildCollectionDocsPrompt([
      {
        method: "GET",
        url: "https://x",
        headers: { Authorization: "Bearer SECRET", "X-Trace": "abc" },
      },
    ]);
    expect(p).toContain("X-Trace");
    expect(p).not.toContain("Bearer SECRET");
  });

  it("uses default title when none provided", () => {
    const p = buildCollectionDocsPrompt(endpoints);
    expect(p).toContain("API Collection");
  });
});

describe("isValidDocsOutput", () => {
  it("accepts a doc with heading + code block", () => {
    const md = `# API Title\n\n## Overview\n\nThis endpoint creates a user.\n\n## Example\n\n\`\`\`js\nconst response = await fetch("https://api.example.com/users", { method: "POST" });\nconst data = await response.json();\n\`\`\`\n`;
    expect(isValidDocsOutput(md)).toBe(true);
  });

  it("rejects empty / too-short", () => {
    expect(isValidDocsOutput("")).toBe(false);
    expect(isValidDocsOutput("hi")).toBe(false);
  });

  it("rejects doc without heading", () => {
    expect(isValidDocsOutput("just some text and a code block ```x```")).toBe(false);
  });

  it("rejects doc without code block", () => {
    expect(isValidDocsOutput("# Title\n\nNo code block here, just text.")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidDocsOutput(null as any)).toBe(false);
    expect(isValidDocsOutput(42 as any)).toBe(false);
  });
});
