import { describe, it, expect } from "vitest";
import {
  tokenizePath,
  resolveJsonPath,
  tryParseJson,
  getValueByPath,
  parseResponseForExtraction,
  isSourcePathSyntaxValid,
} from "../index.js";

describe("tokenizePath", () => {
  it("splits dotted paths", () => {
    expect(tokenizePath("a.b.c")).toEqual(["a", "b", "c"]);
  });

  it("splits bracket notation", () => {
    expect(tokenizePath("items[0]")).toEqual(["items", "0"]);
    expect(tokenizePath("items[2].name")).toEqual(["items", "2", "name"]);
  });

  it("handles mixed notation", () => {
    expect(tokenizePath("data.items[3].meta.value")).toEqual([
      "data",
      "items",
      "3",
      "meta",
      "value",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenizePath("")).toEqual([]);
  });
});

describe("resolveJsonPath", () => {
  const obj = {
    user: { id: 1, name: "Alice" },
    items: [10, 20, 30],
    nested: { deep: { value: "found" } },
  };

  it("resolves nested objects", () => {
    expect(resolveJsonPath(obj, "user.name")).toBe("Alice");
  });

  it("resolves array indices", () => {
    expect(resolveJsonPath(obj, "items[1]")).toBe(20);
  });

  it("resolves nested array-of-objects paths", () => {
    const data = { list: [{ id: "a" }, { id: "b" }] };
    expect(resolveJsonPath(data, "list[0].id")).toBe("a");
    expect(resolveJsonPath(data, "list[1].id")).toBe("b");
  });

  it("returns array length when accessing `.length`", () => {
    expect(resolveJsonPath(obj, "items.length")).toBe(3);
  });

  it("returns undefined for missing paths", () => {
    expect(resolveJsonPath(obj, "user.unknown")).toBeUndefined();
    expect(resolveJsonPath(obj, "items[10]")).toBeUndefined();
  });

  it("returns undefined for empty path", () => {
    expect(resolveJsonPath(obj, "")).toBeUndefined();
  });

  it("returns undefined when descending into a primitive", () => {
    expect(resolveJsonPath(obj, "user.name.foo")).toBeUndefined();
  });
});

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns the original string when parsing fails", () => {
    expect(tryParseJson("not json")).toBe("not json");
  });

  it("returns null for empty input", () => {
    expect(tryParseJson("")).toBeNull();
    expect(tryParseJson(undefined)).toBeNull();
    expect(tryParseJson(null)).toBeNull();
  });
});

describe("getValueByPath", () => {
  const data = { user: { id: 1, name: "Alice" }, items: [{ token: "abc" }] };

  it("returns success with the value when path exists", () => {
    const result = getValueByPath(data, "user.id");
    expect(result.success).toBe(true);
    expect(result.value).toBe(1);
  });

  it("returns success with the original value when path is empty", () => {
    const result = getValueByPath(data, "");
    expect(result.success).toBe(true);
    expect(result.value).toBe(data);
  });

  it("returns failure with an error when path is missing", () => {
    const result = getValueByPath(data, "user.missing");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Path not found");
  });

  it("supports $.prefix style", () => {
    expect(getValueByPath(data, "$.user.name").value).toBe("Alice");
  });

  it("supports bracket notation", () => {
    expect(getValueByPath(data, "items[0].token").value).toBe("abc");
  });
});

describe("parseResponseForExtraction", () => {
  it("parses JSON bodies", () => {
    const result = parseResponseForExtraction('{"ok":true}');
    expect(result.isJson).toBe(true);
    expect(result.parsed).toEqual({ ok: true });
  });

  it("falls back to raw string when not JSON", () => {
    const result = parseResponseForExtraction("plain text");
    expect(result.isJson).toBe(false);
    expect(result.parsed).toBe("plain text");
  });

  it("returns empty parsed for empty bodies", () => {
    const result = parseResponseForExtraction("");
    expect(result.isJson).toBe(false);
    expect(result.parsed).toBe("");
  });
});

describe("isSourcePathSyntaxValid", () => {
  it("accepts valid dotted paths", () => {
    expect(isSourcePathSyntaxValid("a.b.c")).toBe(true);
    expect(isSourcePathSyntaxValid("_foo.bar")).toBe(true);
  });

  it("accepts paths with bracket notation", () => {
    expect(isSourcePathSyntaxValid("data.items[0].id")).toBe(true);
    expect(isSourcePathSyntaxValid("items[2].name")).toBe(true);
  });

  it("accepts $‑prefixed paths", () => {
    expect(isSourcePathSyntaxValid("$.id")).toBe(true);
    expect(isSourcePathSyntaxValid("$.user.name")).toBe(true);
  });

  it("rejects consecutive dots", () => {
    expect(isSourcePathSyntaxValid("a..b")).toBe(false);
  });

  it("accepts empty string (no extraction = use whole value)", () => {
    expect(isSourcePathSyntaxValid("")).toBe(true);
  });

  it("rejects paths with spaces", () => {
    expect(isSourcePathSyntaxValid("data items")).toBe(false);
  });

  it("rejects non‑string input", () => {
    expect(isSourcePathSyntaxValid(undefined as unknown as string)).toBe(false);
    expect(isSourcePathSyntaxValid(null as unknown as string)).toBe(false);
  });
});
