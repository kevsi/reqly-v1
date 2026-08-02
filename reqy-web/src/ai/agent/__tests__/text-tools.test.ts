import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm-tools", () => ({
  REQLY_TOOLS: [{ name: "create_collection" }, { name: "execute_request" }],
}));

import { extractTextToolCalls, stripToolCallText } from "../text-tools";

describe("ai-agent text-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts an XML-style tool call with typed args", () => {
    const text =
      'Je vais créer une collection.\n\n<create_collection>\n  <name>Test</name>\n  <enabled>true</enabled>\n</create_collection>';
    const calls = extractTextToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("create_collection");
    const args = JSON.parse(calls[0].arguments);
    expect(args.name).toBe("Test");
    expect(args.enabled).toBe(true);
  });

  it("extracts a function-style call with JSON args", () => {
    const text = "Je lance la requête : execute_request({\"method\":\"GET\",\"url\":\"/api/users\"})";
    const calls = extractTextToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("execute_request");
    const args = JSON.parse(calls[0].arguments);
    expect(args.method).toBe("GET");
    expect(args.url).toBe("/api/users");
  });

  it("returns empty when no known tool is invoked", () => {
    expect(extractTextToolCalls("Salut, comment ça va ?")).toHaveLength(0);
    expect(extractTextToolCalls("<name>Test</name>")).toHaveLength(0);
  });

  it("strips the tool-call text but keeps surrounding prose", () => {
    const text =
      'Je vais créer une collection.\n\n<create_collection><name>Test</name></create_collection>\n\nC\'est fait !';
    const calls = extractTextToolCalls(text);
    expect(calls).toHaveLength(1);
    const stripped = stripToolCallText(text, calls);
    expect(stripped).toContain("Je vais créer une collection.");
    expect(stripped).toContain("C'est fait !");
    expect(stripped).not.toContain("<create_collection>");
  });

  it("sorts multiple calls by position", () => {
    const text =
      "<create_collection><name>A</name></create_collection> puis execute_request({\"method\":\"GET\",\"url\":\"/x\"})";
    const calls = extractTextToolCalls(text);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].start).toBeLessThan(calls[1].start);
  });

  it("does not treat a nested bare <name> as a call", () => {
    // <name> alone is not a REQLY tool — only <create_collection> etc. are.
    expect(extractTextToolCalls("La collection <name>Test</name>")).toHaveLength(0);
  });
});
