import { describe, it, expect } from "vitest"
import { evaluateAssertion, evaluateAssertions, assertsPassed } from "./assertions.js"
import type { Assertion, RunResult } from "./types.js"

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    name: "test",
    method: "GET",
    url: "https://example.com",
    status: 200,
    statusText: "OK",
    durationMs: 150,
    size: 100,
    passed: true,
    timestamp: Date.now(),
    responseHeaders: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ user: { id: 1, name: "John" }, items: [1, 2, 3] }),
    ...overrides,
  }
}

describe("assertions", () => {
  describe("status assertions", () => {
    it("passes on status == 200", () => {
      const result = evaluateAssertion({ expr: "status == 200" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("fails on status == 200 when actual is 404", () => {
      const result = evaluateAssertion({ expr: "status == 200" }, makeResult({ status: 404 }))
      expect(result.passed).toBe(false)
      expect(result.expected).toBe("200")
      expect(result.actual).toBe("404")
    })

    it("passes on status != 404", () => {
      const result = evaluateAssertion({ expr: "status != 404" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("passes on status > 199", () => {
      const result = evaluateAssertion({ expr: "status > 199" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("passes on status < 300 (less than comparison)", () => {
      const result = evaluateAssertion({ expr: "status < 300" }, makeResult({ status: 200 }))
      expect(result.passed).toBe(true)
    })

    it("fails on status < 100 when actual is 200", () => {
      const result = evaluateAssertion({ expr: "status < 100" }, makeResult({ status: 200 }))
      expect(result.passed).toBe(false)
    })
  })

  describe("body assertions", () => {
    it("passes on body.user.id == 1", () => {
      const result = evaluateAssertion({ expr: "body.user.id == 1" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("fails on body.user.id == 2", () => {
      const result = evaluateAssertion({ expr: "body.user.id == 2" }, makeResult())
      expect(result.passed).toBe(false)
      expect(result.actual).toBe("1")
    })

    it("passes on body.user.name == 'John'", () => {
      const result = evaluateAssertion({ expr: "body.user.name == 'John'" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("passes on body.user.name != null", () => {
      const result = evaluateAssertion({ expr: "body.user.name != null" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("fails on body.nonexistent != null", () => {
      const result = evaluateAssertion({ expr: "body.nonexistent != null" }, makeResult())
      expect(result.passed).toBe(false)
    })

    it("supports array index with bracket notation body.items[0] == 1", () => {
      const result = evaluateAssertion({ expr: "body.items[0] == 1" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("fails on body.items[5] == 1 (out of bounds)", () => {
      const result = evaluateAssertion({ expr: "body.items[5] == 1" }, makeResult())
      expect(result.passed).toBe(false)
    })

    it("passes on body.items.length > 0", () => {
      const result = evaluateAssertion({ expr: "body.items.length > 0" }, makeResult())
      expect(result.passed).toBe(true)
    })

    it("fails on body.items.length == 0", () => {
      const result = evaluateAssertion({ expr: "body.items.length == 0" }, makeResult())
      expect(result.passed).toBe(false)
    })
  })

  describe("header assertions", () => {
    it("passes on headers.content-type contains 'json'", () => {
      const result = evaluateAssertion(
        { expr: "headers.content-type contains 'json'" },
        makeResult()
      )
      expect(result.passed).toBe(true)
    })

    it("fails on headers.content-type contains 'xml'", () => {
      const result = evaluateAssertion(
        { expr: "headers.content-type contains 'xml'" },
        makeResult()
      )
      expect(result.passed).toBe(false)
    })
  })

  describe("duration assertions", () => {
    it("passes on duration < 1000", () => {
      const result = evaluateAssertion({ expr: "duration < 1000" }, makeResult({ durationMs: 150 }))
      expect(result.passed).toBe(true)
    })

    it("fails on duration > 1000 when actual is 500", () => {
      const result = evaluateAssertion({ expr: "duration > 1000" }, makeResult({ durationMs: 500 }))
      expect(result.passed).toBe(false)
    })
  })

  describe("custom assertion names", () => {
    it("uses the name property when provided", () => {
      const result = evaluateAssertion(
        { name: "My custom check", expr: "status == 200" },
        makeResult()
      )
      expect(result.name).toBe("My custom check")
    })

    it("falls back to expression when no name", () => {
      const result = evaluateAssertion({ expr: "status == 200" }, makeResult())
      expect(result.name).toBe("status == 200")
    })
  })

  describe("variable interpolation in assertions", () => {
    it("resolves {{var}} in expected values", () => {
      const vars = new Map([["expectedId", "1"]])
      const result = evaluateAssertion(
        { expr: "body.user.id == {{expectedId}}" },
        makeResult(),
        vars
      )
      expect(result.passed).toBe(true)
    })

    it("resolves {{var}} in expression fields", () => {
      const vars = new Map([["field", "body.user.id"]])
      const result = evaluateAssertion(
        { expr: "body.user.id == 1" },
        makeResult(),
        vars
      )
      expect(result.passed).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("handles invalid expression format", () => {
      const result = evaluateAssertion({ expr: "notavalidformat" }, makeResult())
      expect(result.passed).toBe(false)
      expect(result.error).toBeDefined()
    })

    it("handles non-JSON body gracefully", () => {
      const result = evaluateAssertion(
        { expr: "body == 'plain text'" },
        makeResult({ body: "plain text" })
      )
      expect(result.passed).toBe(true)
    })

    it("handles empty body", () => {
      const result = evaluateAssertion(
        { expr: "status == 200" },
        makeResult({ body: undefined })
      )
      expect(result.passed).toBe(true)
    })

    it("handles status with == comparing to string", () => {
      const result = evaluateAssertion({ expr: "status == '200'" }, makeResult())
      expect(result.passed).toBe(true)
    })
  })

  describe("evaluateAssertions (batch)", () => {
    it("evaluates multiple assertions", () => {
      const assertions: Assertion[] = [
        { expr: "status == 200" },
        { expr: "body.user.id == 1" },
        { expr: "duration < 1000" },
      ]
      const results = evaluateAssertions(assertions, makeResult())
      expect(results).toHaveLength(3)
      expect(results.every((r) => r.passed)).toBe(true)
    })

    it("reports failures correctly", () => {
      const assertions: Assertion[] = [
        { expr: "status == 200" },
        { expr: "status == 404" },
      ]
      const results = evaluateAssertions(assertions, makeResult())
      expect(results[0].passed).toBe(true)
      expect(results[1].passed).toBe(false)
    })
  })

  describe("assertsPassed", () => {
    it("returns true when all pass", () => {
      const results = evaluateAssertions(
        [{ expr: "status == 200" }, { expr: "body.user.id == 1" }],
        makeResult()
      )
      expect(assertsPassed(results)).toBe(true)
    })

    it("returns false when any fails", () => {
      const results = evaluateAssertions(
        [{ expr: "status == 200" }, { expr: "status == 404" }],
        makeResult()
      )
      expect(assertsPassed(results)).toBe(false)
    })
  })
})
