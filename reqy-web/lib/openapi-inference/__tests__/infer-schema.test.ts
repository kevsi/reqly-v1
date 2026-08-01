import { describe, it, expect } from "vitest"
import { inferSchemaFromValue } from "@/lib/openapi-inference/infer-schema"

describe("inferSchemaFromValue", () => {
  it("infers string", () => {
    expect(inferSchemaFromValue("hello")).toEqual({ type: "string" })
  })

  it("infers number", () => {
    expect(inferSchemaFromValue(42)).toEqual({ type: "number" })
  })

  it("infers boolean", () => {
    expect(inferSchemaFromValue(true)).toEqual({ type: "boolean" })
  })

  it("infers null", () => {
    expect(inferSchemaFromValue(null)).toEqual({ type: "null" })
  })

  it("infers object with required fields", () => {
    const schema = inferSchemaFromValue({ id: "1", name: "Alice" })
    expect(schema).toEqual({
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
    })
  })

  it("infers nested object", () => {
    const schema = inferSchemaFromValue({ user: { id: 1, tags: ["a", "b"] } })
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            id: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    })
  })

  it("infers array of objects with allOf merge", () => {
    const schema = inferSchemaFromValue([{ a: 1 }, { a: 2, b: "x" }])
    expect(schema.type).toBe("array")
    const items = schema.items as { allOf: Record<string, unknown>[] }
    expect(items.allOf).toHaveLength(2)
  })

  it("infers empty array", () => {
    expect(inferSchemaFromValue([])).toEqual({ type: "array", items: {} })
  })

  it("deduplicates identical schemas in array", () => {
    const schema = inferSchemaFromValue([{ a: 1 }, { a: 1 }])
    // After dedupe, only one unique schema remains → items has no allOf wrapper
    expect(schema).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: { a: { type: "number" } },
        required: ["a"],
      },
    })
  })
})
