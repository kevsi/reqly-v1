import { describe, it, expect, beforeEach } from "vitest"
import { createScriptContext, executeScript, ScriptError } from "./scripting.js"
import type { RunnerContext, RequestItem, RunResult } from "./types.js"

function makeCtx(): RunnerContext {
  const envVars = new Map<string, string>([["API_KEY", "secret123"]])
  return { vars: new Map(), envVars, cookies: new Map(), iteration: 0, data: {} }
}

function makeRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    name: "test",
    method: "GET",
    url: "https://api.example.com/users",
    endpoint: "/users",
    ...overrides,
  }
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    name: "test",
    method: "GET",
    url: "https://api.example.com/users",
    status: 200,
    statusText: "OK",
    durationMs: 100,
    size: 50,
    passed: true,
    body: JSON.stringify({ id: 1, name: "John", email: "john@test.com" }),
    responseHeaders: { "content-type": "application/json" },
    timestamp: Date.now(),
    ...overrides,
  }
}

describe("scripting", () => {
  describe("createScriptContext", () => {
    it("creates context with env API", () => {
      const ctx = makeCtx()
      const sc = createScriptContext(ctx, makeRequest())
      expect(sc.env.get("API_KEY")).toBe("secret123")
      sc.env.set("NEW_KEY", "value")
      expect(ctx.envVars.get("NEW_KEY")).toBe("value")
      sc.env.unset("API_KEY")
      expect(ctx.envVars.has("API_KEY")).toBe(false)
    })

    it("creates context with vars API", () => {
      const ctx = makeCtx()
      ctx.vars.set("userId", "42")
      const sc = createScriptContext(ctx, makeRequest())
      expect(sc.vars.get("userId")).toBe("42")
      sc.vars.set("token", "abc")
      expect(ctx.vars.get("token")).toBe("abc")
      sc.vars.unset("userId")
      expect(ctx.vars.has("userId")).toBe(false)
    })

    it("creates context with request API", () => {
      const sc = createScriptContext(makeCtx(), makeRequest())
      expect(sc.request.method).toBe("GET")
      expect(sc.request.url).toBe("https://api.example.com/users")
      sc.request.setHeader("X-Test", "value")
      sc.request.setUrl("https://other.com")
      sc.request.setMethod("POST")
      sc.request.setBody('{"test":true}')
    })

    it("includes response API when result is provided", () => {
      const result = makeResult({ body: '{"id":1}' })
      const sc = createScriptContext(makeCtx(), makeRequest(), result)
      expect(sc.response).toBeDefined()
      expect(sc.response!.status).toBe(200)
      expect(sc.response!.json()).toEqual({ id: 1 })
      expect(sc.response!.text()).toBe('{"id":1}')
    })

    it("does not include response API when result is not provided", () => {
      const sc = createScriptContext(makeCtx(), makeRequest())
      expect(sc.response).toBeUndefined()
    })
  })

  describe("executeScript", () => {
    describe("pre-request scripts", () => {
      it("executes a simple script", () => {
        const ctx = makeCtx()
        const sc = createScriptContext(ctx, makeRequest())
        executeScript('vars.set("test", "hello")', sc, "pre")
        expect(ctx.vars.get("test")).toBe("hello")
      })

      it("modifies request via API", () => {
        const req = makeRequest()
        const sc = createScriptContext(makeCtx(), req)
        executeScript('request.setMethod("POST"); request.setUrl("https://other.com")', sc, "pre")
        expect(req.method).toBe("POST")
        expect(req.url).toBe("https://other.com")
      })

      it("reads env variables", () => {
        const ctx = makeCtx()
        ctx.envVars.set("BASE_URL", "https://api.example.com")
        const sc = createScriptContext(ctx, makeRequest())
        executeScript('vars.set("url", env.get("BASE_URL"))', sc, "pre")
        expect(ctx.vars.get("url")).toBe("https://api.example.com")
      })

      it("handles script errors gracefully", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        expect(() => executeScript('throw new Error("boom")', sc, "pre")).toThrow(ScriptError)
      })

      it("ignores empty or whitespace scripts", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        expect(() => executeScript("", sc, "pre")).not.toThrow()
        expect(() => executeScript("   ", sc, "pre")).not.toThrow()
      })
    })

    describe("post-response scripts", () => {
      it("asserts response status", () => {
        const result = makeResult({ status: 200 })
        const sc = createScriptContext(makeCtx(), makeRequest(), result)
        executeScript('expect(response.status).toBe(200)', sc, "post")
      })

      it("fails on wrong status", () => {
        const result = makeResult({ status: 404 })
        const sc = createScriptContext(makeCtx(), makeRequest(), result)
        expect(() => executeScript('expect(response.status).toBe(200)', sc, "post"))
          .toThrow(ScriptError)
      })

      it("accesses response body via json()", () => {
        const result = makeResult({ body: '{"id":1,"name":"John"}' })
        const sc = createScriptContext(makeCtx(), makeRequest(), result)
        executeScript(`
          const data = response.json()
          expect(data.id).toBe(1)
          expect(data.name).toBe("John")
        `, sc, "post")
      })

      it("sets env vars from response", () => {
        const ctx = makeCtx()
        const result = makeResult({ body: '{"token":"abc123"}' })
        const sc = createScriptContext(ctx, makeRequest(), result)
        executeScript('const d = response.json(); env.set("TOKEN", d.token)', sc, "post")
        expect(ctx.envVars.get("TOKEN")).toBe("abc123")
      })

      it("uses expect().toContain()", () => {
        const result = makeResult({ body: '{"name":"John Doe"}' })
        const sc = createScriptContext(makeCtx(), makeRequest(), result)
        executeScript('const d = response.json(); expect(d.name).toContain("John")', sc, "post")
      })

      it("uses expect().toBeGreaterThan() and toBeLessThan()", () => {
        const result = makeResult({ status: 200 })
        const sc = createScriptContext(makeCtx(), makeRequest(), result)
        executeScript('expect(response.status).toBeGreaterThan(199); expect(response.status).toBeLessThan(300)', sc, "post")
      })

      it("uses expect().toMatch()", () => {
        const result = makeResult({ status: 200 })
        const sc = createScriptContext(makeCtx(), makeRequest(), result)
        executeScript('expect(response.statusText).toMatch(/^OK$/)', sc, "post")
      })
    })

    describe("security sandbox", () => {
      it("does not allow require", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        expect(() => executeScript('require("fs")', sc, "pre")).toThrow()
      })

      it("does not allow process access", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        expect(() => executeScript('process.exit()', sc, "pre")).toThrow()
      })

      it("does not allow fetch", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        expect(() => executeScript('fetch("http://evil.com")', sc, "pre")).toThrow()
      })

      it("safe wrappers still allow JSON usage", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        executeScript('vars.set("data", JSON.stringify({a:1}))', sc, "pre")
        // JSON.stringify should still work via safe wrapper
      })

      it("safe wrappers still allow Math usage", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        executeScript('vars.set("val", String(Math.max(1, 2, 3)))', sc, "pre")
      })

      it("safe wrappers still allow Date.now()", () => {
        const sc = createScriptContext(makeCtx(), makeRequest())
        executeScript('vars.set("ts", String(Date.now()))', sc, "pre")
      })
    })
  })
})
