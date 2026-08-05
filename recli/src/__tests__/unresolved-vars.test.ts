import { describe, it, expect } from "vitest";
import { interpolate } from "../chaining.js";
import type { RunnerContext } from "../types.js";

function makeCtx(): RunnerContext {
  return {
    vars: new Map([["id", "42"]]),
    envVars: new Map([["BASE_URL", "https://api.example.com"]]),
    cookies: new Map(),
    iteration: 0,
    unresolvedVars: new Set(),
  };
}

describe("interpolate unresolved-variable tracking", () => {
  it("resolves known vars without recording anything", () => {
    const ctx = makeCtx();
    const out = interpolate("{{BASE_URL}}/users/{{id}}", ctx);
    expect(out).toBe("https://api.example.com/users/42");
    expect(ctx.unresolvedVars!.size).toBe(0);
  });

  it("records unknown {{var}} names for a run-level warning", () => {
    const ctx = makeCtx();
    const out = interpolate("{{BASE_URL}}/{{UNSET_VAR}}/{{OTHER}}", ctx);
    expect(out).toBe("https://api.example.com/{{UNSET_VAR}}/{{OTHER}}");
    expect([...ctx.unresolvedVars!]).toEqual(["UNSET_VAR", "OTHER"]);
  });

  it("records unknown dynamic {{$...}} names too", () => {
    const ctx = makeCtx();
    interpolate("{{$notARealDynamic}}", ctx);
    expect([...ctx.unresolvedVars!]).toEqual(["$notARealDynamic"]);
  });

  it("does not crash when the context has no unresolvedVars set", () => {
    const ctx = makeCtx();
    delete ctx.unresolvedVars;
    expect(() => interpolate("{{NOPE}}", ctx)).not.toThrow();
  });
});
