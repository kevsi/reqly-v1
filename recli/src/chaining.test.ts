import { describe, it, expect } from "vitest"
import { applyCaptures, interpolate } from "./chaining.js"
import type { CaptureRule, RunResult, RunnerContext } from "./types.js"

function makeCtx(extraVars: Record<string, string> = {}): RunnerContext {
  const map = new Map(Object.entries(extraVars))
  return {
    vars: map,
    envVars: new Map(),
    cookies: new Map(),
    iteration: 0,
    data: {},
  }
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    name: "test",
    method: "GET",
    url: "https://example.com/api/users/1",
    status: 200,
    statusText: "OK",
    durationMs: 100,
    size: 50,
    passed: true,
    body: JSON.stringify({ id: 1, name: "John", email: "john@test.com" }),
    responseHeaders: { "x-request-id": "abc123", "content-type": "application/json" },
    timestamp: Date.now(),
    ...overrides,
  }
}

describe("chaining", () => {
  describe("applyCaptures", () => {
    it("captures a simple body field", () => {
      const ctx = makeCtx()
      const captures: CaptureRule[] = [{ name: "userId", expr: "body.id" }]
      const result = applyCaptures(captures, makeResult(), ctx)
      expect(result.userId).toBe("1")
      expect(ctx.vars.get("userId")).toBe("1")
    })

    it("captures a nested body field", () => {
      const body = JSON.stringify({ data: { user: { token: "secret123" } } })
      const ctx = makeCtx()
      const captures: CaptureRule[] = [{ name: "token", expr: "body.data.user.token" }]
      const result = applyCaptures(captures, makeResult({ body }), ctx)
      expect(result.token).toBe("secret123")
    })

    it("captures from array response", () => {
      const body = JSON.stringify([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ])
      const ctx = makeCtx()
      const captures: CaptureRule[] = [{ name: "firstId", expr: "body[0].id" }]
      const result = applyCaptures(captures, makeResult({ body }), ctx)
      expect(result.firstId).toBe("1")
    })

    it("captures a header value", () => {
      const ctx = makeCtx()
      const captures: CaptureRule[] = [{ name: "requestId", expr: "headers.x-request-id" }]
      const result = applyCaptures(captures, makeResult(), ctx)
      expect(result.requestId).toBe("abc123")
    })

    it("captures the status code", () => {
      const ctx = makeCtx()
      const captures: CaptureRule[] = [{ name: "statusCode", expr: "status" }]
      const result = applyCaptures(captures, makeResult({ status: 201 }), ctx)
      expect(result.statusCode).toBe("201")
    })

    it("returns empty object when no captures match", () => {
      const ctx = makeCtx()
      const result = applyCaptures([], makeResult(), ctx)
      expect(result).toEqual({})
    })

    it("skips captures when expression doesn't resolve", () => {
      const ctx = makeCtx()
      const captures: CaptureRule[] = [{ name: "missing", expr: "body.nonexistent.deep" }]
      const result = applyCaptures(captures, makeResult(), ctx)
      expect(result.missing).toBeUndefined()
    })

    it("captures multiple values in one call", () => {
      const ctx = makeCtx()
      const captures: CaptureRule[] = [
        { name: "id", expr: "body.id" },
        { name: "name", expr: "body.name" },
      ]
      const result = applyCaptures(captures, makeResult(), ctx)
      expect(result.id).toBe("1")
      expect(result.name).toBe("John")
    })
  })

  describe("interpolate", () => {
    it("replaces {{var}} from context vars", () => {
      const ctx = makeCtx({ token: "abc123" })
      const result = interpolate("Bearer {{token}}", ctx)
      expect(result).toBe("Bearer abc123")
    })

    it("replaces multiple variables", () => {
      const ctx = makeCtx({ host: "api.example.com", port: "443" })
      const result = interpolate("https://{{host}}:{{port}}/v1", ctx)
      expect(result).toBe("https://api.example.com:443/v1")
    })

    it("replaces variables in URL path", () => {
      const ctx = makeCtx({ userId: "42" })
      const result = interpolate("https://api.example.com/users/{{userId}}", ctx)
      expect(result).toBe("https://api.example.com/users/42")
    })

    it("leaves unresolved variables as-is", () => {
      const ctx = makeCtx({})
      const result = interpolate("Bearer {{unresolved}}", ctx)
      expect(result).toBe("Bearer {{unresolved}}")
    })

    it("handles empty string", () => {
      const ctx = makeCtx({ userId: "42" })
      const result = interpolate("", ctx)
      expect(result).toBe("")
    })

    it("handles string with no variables", () => {
      const ctx = makeCtx()
      const result = interpolate("https://example.com", ctx)
      expect(result).toBe("https://example.com")
    })

    it("trims whitespace inside {{ var }}", () => {
      const ctx = makeCtx({ key: "value" })
      const result = interpolate("{{ key }}", ctx)
      expect(result).toBe("value")
    })

    it("does not replace {{ with no closing braces", () => {
      const ctx = makeCtx({ key: "value" })
      const result = interpolate("{{key", ctx)
      expect(result).toBe("{{key")
    })
  })
})
