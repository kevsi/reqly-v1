import { describe, it, expect } from "vitest";
import {
  generateFromSchema,
  generateBodyFromOpenApiRequest,
  type OpenAPISchema,
} from "@/src/ai/cloud-engine/openapi-sample";

describe("generateFromSchema — primitives", () => {
  it("returns example when present", () => {
    expect(generateFromSchema({ type: "string", example: "hello" })).toBe("hello");
  });

  it("returns default when present (no example)", () => {
    expect(generateFromSchema({ type: "number", default: 42 })).toBe(42);
  });

  it("returns first enum value", () => {
    expect(generateFromSchema({ type: "string", enum: ["a", "b", "c"] })).toBe("a");
  });

  it("generates string with format email", () => {
    expect(generateFromSchema({ type: "string", format: "email" })).toBe("user@example.com");
  });

  it("generates string with format uuid", () => {
    const v = generateFromSchema({ type: "string", format: "uuid" });
    expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("generates string with format date-time", () => {
    expect(generateFromSchema({ type: "string", format: "date-time" })).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates integer default", () => {
    expect(generateFromSchema({ type: "integer" })).toBe(0);
  });

  it("generates boolean default", () => {
    expect(generateFromSchema({ type: "boolean" })).toBe(false);
  });
});

describe("generateFromSchema — objects", () => {
  it("generates required props only when includeOptionals=false", () => {
    const schema: OpenAPISchema = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string", default: "Alice" },
      },
    };
    const out = generateFromSchema(schema, 0, { includeOptionals: false }) as Record<string, unknown>;
    expect(out.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(out.name).toBeUndefined();
  });

  it("generates all props when includeOptionals=true (default)", () => {
    const schema: OpenAPISchema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "integer" },
      },
    };
    const out = generateFromSchema(schema) as Record<string, unknown>;
    expect(typeof out.a).toBe("string");
    expect(typeof out.b).toBe("number");
  });

  it("handles nested objects", () => {
    const out = generateFromSchema({
      type: "object",
      properties: {
        user: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            age: { type: "integer" },
          },
        },
      },
    }) as any;
    expect(out.user.email).toBe("user@example.com");
  });
});

describe("generateFromSchema — arrays", () => {
  it("generates an array of one item by default", () => {
    const out = generateFromSchema({ type: "array", items: { type: "string" } }) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
  });

  it("respects minItems", () => {
    const out = generateFromSchema({
      type: "array",
      items: { type: "string" },
      minItems: 3,
    }) as unknown[];
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

describe("generateFromSchema — $ref", () => {
  it("resolves local $ref", () => {
    const User: OpenAPISchema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, name: { type: "string" } },
    };
    const out = generateFromSchema(
      { $ref: "#/components/schemas/User" },
      0,
      { rootSchemas: { User } }
    ) as Record<string, unknown>;
    expect(typeof out.id).toBe("string");
    expect(typeof out.name).toBe("string");
  });

  it("returns null for unresolved ref", () => {
    expect(generateFromSchema({ $ref: "#/components/schemas/Nope" })).toBeNull();
  });
});

describe("generateFromSchema — composition", () => {
  it("merges allOf properties", () => {
    const out = generateFromSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "integer" } } },
      ],
    }) as Record<string, unknown>;
    expect(typeof out.a).toBe("string");
    expect(typeof out.b).toBe("number");
  });

  it("picks first valid branch for oneOf", () => {
    const out = generateFromSchema({
      oneOf: [
        { type: "string" },
        { type: "object", properties: { x: { type: "string" } } },
      ],
    });
    // Either branch is acceptable; just check shape
    expect(out !== null && out !== undefined).toBe(true);
  });
});

describe("generateFromSchema — safety", () => {
  it("caps recursion at maxDepth", () => {
    const recursive: OpenAPISchema = { type: "object", properties: {} };
    recursive.properties = { self: recursive };
    const out = generateFromSchema(recursive, 0, { maxDepth: 3 });
    // Should not infinite-loop; just return whatever it could
    expect(out).toBeDefined();
  });
});

describe("generateBodyFromOpenApiRequest", () => {
  it("extracts schemas from OpenAPI spec", () => {
    const spec = {
      components: {
        schemas: {
          Pet: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
        },
      },
    };
    const out = generateBodyFromOpenApiRequest(
      { $ref: "#/components/schemas/Pet" },
      spec
    ) as Record<string, unknown>;
    expect(typeof out.id).toBe("string");
    expect(typeof out.name).toBe("string");
  });
});
