import { describe, it, expect, vi } from "vitest";

const mockCreateContext = vi.fn((sandbox) => sandbox);

vi.mock("node:vm", () => ({
  Script: class {
    constructor(code: string) {
      this.code = code;
    }
    runInContext(ctx: unknown, _options?: unknown) {
      const fn = new Function(
        "pm",
        "console",
        "Math",
        "Date",
        "JSON",
        "Array",
        "Object",
        "String",
        "Number",
        "Boolean",
        "RegExp",
        "Map",
        "Set",
        "URL",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURIComponent",
        "decodeURIComponent",
        `return (${this.code});`,
      );
      return fn(
        ctx.pm,
        ctx.console,
        ctx.Math,
        ctx.Date,
        ctx.JSON,
        ctx.Array,
        ctx.Object,
        ctx.String,
        ctx.Number,
        ctx.Boolean,
        ctx.RegExp,
        ctx.Map,
        ctx.Set,
        ctx.URL,
        ctx.parseInt,
        ctx.parseFloat,
        ctx.isNaN,
        ctx.isFinite,
        ctx.encodeURIComponent,
        ctx.decodeURIComponent,
      );
    }
  },
  createContext: (...args: unknown[]) => mockCreateContext(...args),
}));

import { runScript } from "@/lib/test-runner/scripts";
import type { RunnerContext } from "@/lib/test-runner/types";

const baseCtx: RunnerContext = {
  environment: { baseUrl: "https://api.example.com" },
  iterationData: { userId: "42" },
  iterationIndex: 0,
  log: () => {},
};

describe("runScript", () => {
  it("reads environment variables", async () => {
    const out = await runScript("pm.environment.get('baseUrl')", baseCtx, { phase: "pre" });
    expect(out.error).toBeUndefined();
    expect(out.result).toBe("https://api.example.com");
  });

  it("sets environment variables", async () => {
    const ctx: RunnerContext = { ...baseCtx, environment: { ...baseCtx.environment } };
    await runScript("pm.environment.set('token', 'abc123')", ctx, { phase: "pre" });
    expect(ctx.environment.token).toBe("abc123");
  });

  it("captures console.log output", async () => {
    const logs: string[] = [];
    const ctx: RunnerContext = { ...baseCtx, log: (m) => logs.push(m) };
    await runScript("console.log('hello')", ctx, { phase: "pre" });
    expect(logs).toContain("hello");
  });

  it("denies require access", async () => {
    const out = await runScript("require('fs')", baseCtx, { phase: "pre" });
    expect(out.error).toBeDefined();
  });

  it("denies process.exit", async () => {
    const out = await runScript("process.exit(1)", baseCtx, { phase: "pre" });
    expect(out.error).toBeDefined();
  });

  it("denies network egress globals (fetch, WebSocket)", async () => {
    const fetchOut = await runScript("fetch('https://evildomain.test')", baseCtx, { phase: "pre" });
    expect(fetchOut.error).toBeDefined();
    const wsOut = await runScript("new WebSocket('wss://evildomain.test')", baseCtx, {
      phase: "pre",
    });
    expect(wsOut.error).toBeDefined();
  });

  it("denies async runaway globals (setTimeout, queueMicrotask)", async () => {
    const to = await runScript("setTimeout(() => {}, 1)", baseCtx, { phase: "pre" });
    expect(to.error).toBeDefined();
    const q = await runScript("queueMicrotask(() => {})", baseCtx, { phase: "pre" });
    expect(q.error).toBeDefined();
  });

  it("returns error on syntax error", async () => {
    const out = await runScript("this is not valid javascript", baseCtx, { phase: "pre" });
    expect(out.error).toBeDefined();
  });

  it("times out on infinite loop", async () => {
    const out = await runScript("while (true) {}", baseCtx, { phase: "pre", timeoutMs: 200 });
    expect(out.error).toBeDefined();
  });

  it("exposes iterationData in pre phase", async () => {
    const out = await runScript("pm.iterationData.get('userId')", baseCtx, { phase: "pre" });
    expect(out.result).toBe("42");
  });

  it("exposes pm.expect().to.equal() and throws on mismatch", async () => {
    const pass = await runScript("pm.expect(5).to.equal(5)", baseCtx, { phase: "post" });
    expect(pass.error).toBeUndefined();
    const fail = await runScript("pm.expect(5).to.equal(6)", baseCtx, { phase: "post" });
    expect(fail.error).toBeDefined();
  });

  it("aliases pm.response.code/status/statusCode (regression #response-code)", async () => {
    const ctx: RunnerContext = { ...baseCtx, environment: { ...baseCtx.environment } };
    const response = { statusCode: 200, responseTimeMs: 123, body: '{"ok":true}', headers: { "content-type": "application/json" } };
    const outCode = await runScript("pm.response.code", ctx, { phase: "post", response });
    expect(outCode.result).toBe(200);
    const outStatus = await runScript("pm.response.status", ctx, { phase: "post", response });
    expect(outStatus.result).toBe(200);
    const outStatusCode = await runScript("pm.response.statusCode", ctx, { phase: "post", response });
    expect(outStatusCode.result).toBe(200);
    const outExpect = await runScript("pm.expect(pm.response.code).to.equal(200)", ctx, { phase: "post", response });
    expect(outExpect.error).toBeUndefined();
  });
});
