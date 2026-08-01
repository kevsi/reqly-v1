import { describe, it, expect } from "vitest"
import { mergeInferredWithGeneric } from "@/lib/openapi-inference/merge-schemas"

describe("mergeInferredWithGeneric", () => {
  it("returns inferred as-is when identical", () => {
    const s = { type: "object", properties: { id: { type: "string" } } }
    expect(mergeInferredWithGeneric(s, s)).toBe(s)
  })

  it("combines via allOf when different", () => {
    const inferred = { type: "object", properties: { id: { type: "string" } } }
    const generic = { type: "object" }
    expect(mergeInferredWithGeneric(inferred, generic)).toEqual({ allOf: [generic, inferred] })
  })
})
