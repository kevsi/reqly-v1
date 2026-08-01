import { describe, it, expect } from "vitest";
import { inferJsonSchema, diffSchemas, typeOf } from "@/lib/schema-diff";

describe("schema-diff: infer + diff", () => {
  it("infers a schema from a sample response", () => {
    const s = inferJsonSchema({ id: 1, name: "x", tags: ["a"] });
    expect(s.properties.id.type).toBe("integer");
    expect(s.properties.tags.type).toBe("array");
  });

  it("detects a removed field and a type change", () => {
    const oldS = inferJsonSchema({ id: 1, name: "x" });
    const newS = inferJsonSchema({ id: "abc" }); // name removed, id type changed
    const changes = diffSchemas(oldS, newS);
    expect(changes.some((c) => c.path === "name" && c.kind === "removed")).toBe(true);
    expect(changes.some((c) => c.path === "id" && c.kind === "type-changed")).toBe(true);
  });

  // --- additional coverage for the shared lib's branches ---

  it("typeOf maps JS values to JSON-Schema types", () => {
    expect(typeOf(null)).toBe("null");
    expect(typeOf([1, 2])).toBe("array");
    expect(typeOf({})).toBe("object");
    expect(typeOf("x")).toBe("string");
    expect(typeOf(true)).toBe("boolean");
    expect(typeOf(3.14)).toBe("number");
    expect(typeOf(7)).toBe("integer");
    expect(typeOf(undefined)).toBe("null");
  });

  it("infers nested objects and array items", () => {
    const s = inferJsonSchema({ user: { id: 1, name: "a" }, tags: ["x", "y"] });
    expect(s.properties.user.type).toBe("object");
    expect(s.properties.user.properties.id.type).toBe("integer");
    expect(s.properties.tags.type).toBe("array");
    expect(s.properties.tags.items.type).toBe("string");
  });

  it("caps recursion at maxDepth (objects not expanded past the limit)", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const s = inferJsonSchema(deep, { maxDepth: 1 });
    expect(s.properties.a.type).toBe("object");
    // beyond depth 1 we stop expanding nested properties
    expect(s.properties.a.properties).toBeUndefined();
  });

  it("detects an added field", () => {
    const oldS = inferJsonSchema({ id: 1 });
    const newS = inferJsonSchema({ id: 1, name: "x" });
    const changes = diffSchemas(oldS, newS);
    expect(changes.some((c) => c.path === "name" && c.kind === "added")).toBe(true);
  });

  it("detects a type change to null", () => {
    const oldS = inferJsonSchema({ id: 1 });
    const newS = inferJsonSchema({ id: null });
    const changes = diffSchemas(oldS, newS);
    expect(changes.some((c) => c.path === "id" && c.kind === "type-changed:null")).toBe(true);
  });

  it("recurses into nested objects and arrays when types are equal", () => {
    const oldS = inferJsonSchema({ user: { id: 1 }, tags: ["a"] });
    const newS = inferJsonSchema({ user: { id: "x" }, tags: [1] });
    const changes = diffSchemas(oldS, newS);
    expect(changes.some((c) => c.path === "user.id" && c.kind === "type-changed")).toBe(true);
    // array item type change is reported on the "<path>[]" item path
    expect(changes.some((c) => c.path === "tags[]" && c.kind === "type-changed")).toBe(true);
  });
});
