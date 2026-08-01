import { describe, it, expect } from "vitest"
import { evaluateAssertions } from "@/lib/test-runner/assertions"
import type { Assertion, RequestResponse } from "@/lib/test-runner/types"

const baseResponse: RequestResponse = {
  statusCode: 200,
  responseTimeMs: 120,
  body: { id: "abc", name: "Alice" },
  headers: { "content-type": "application/json" },
}

describe("evaluateAssertions", () => {
  it("status code matches number", () => {
    const a: Assertion = { type: "status", expected: 200 }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("status code does not match", () => {
    const a: Assertion = { type: "status", expected: 404 }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(false)
  })

  it("status code in `in` list", () => {
    const a: Assertion = { type: "status", expected: { in: [200, 201, 204] } }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("status code NOT in `not` list", () => {
    const a: Assertion = { type: "status", expected: { not: 500 } }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("responseTime below threshold", () => {
    const a: Assertion = { type: "responseTime", operator: "<", valueMs: 500 }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("responseTime above threshold", () => {
    const a: Assertion = { type: "responseTime", operator: "<", valueMs: 50 }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(false)
  })

  it("jsonPath equals match", () => {
    const a: Assertion = { type: "jsonPath", path: "$.id", operator: "equals", value: "abc" }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("jsonPath equals mismatch", () => {
    const a: Assertion = { type: "jsonPath", path: "$.id", operator: "equals", value: "xyz" }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(false)
  })

  it("jsonPath contains substring (case-insensitive)", () => {
    const a: Assertion = { type: "jsonPath", path: "$.name", operator: "contains", value: "ALIC" }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("jsonPath exists when path resolves", () => {
    const a: Assertion = { type: "jsonPath", path: "$.id", operator: "exists" }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("schema validation passes", () => {
    const a: Assertion = {
      type: "schema",
      schema: {
        type: "object",
        required: ["id", "name"],
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
    }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(true)
  })

  it("schema validation fails when missing required", () => {
    const a: Assertion = { type: "schema", schema: { type: "object", required: ["missing"] } }
    const [r] = evaluateAssertions([a], baseResponse)
    expect(r.passed).toBe(false)
  })
})
