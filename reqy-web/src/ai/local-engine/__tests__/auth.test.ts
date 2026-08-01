import { describe, it, expect } from "vitest";
import { authRules } from "@/src/ai/local-engine/rules/auth";
import type { RequestContext } from "@/src/ai/types";
import errorDataset from "@/src/ai/__tests__/fixtures/error-dataset.json";

function ctxFromFixture(id: string): RequestContext {
  const fixture = (errorDataset as any[]).find((f) => f.id === id);
  if (!fixture) throw new Error(`Fixture ${id} not found`);
  return { ...fixture.context, timestamp: Date.now() } as RequestContext;
}

function matchRule(id: string, ctx: RequestContext) {
  return authRules.find((r) => r.id === id);
}

describe("auth.401.bearer.missing", () => {
  const rule = matchRule("auth.401.bearer.missing", ctxFromFixture("auth-401-bearer-missing-001"))!;
  it("matches when 401 and no Authorization header", () => {
    expect(rule).toBeDefined();
    expect(rule.match(ctxFromFixture("auth-401-bearer-missing-001"))).toBe(true);
  });
  it("does not match when Bearer token is present", () => {
    expect(rule.match(ctxFromFixture("auth-401-bearer-expired-002"))).toBe(false);
  });
});

describe("auth.401.bearer.expired", () => {
  const rule = matchRule("auth.401.bearer.expired", ctxFromFixture("auth-401-bearer-expired-002"))!;
  it("matches when 401 + Bearer + error_description mentions expiration", () => {
    expect(rule).toBeDefined();
    expect(rule.match(ctxFromFixture("auth-401-bearer-expired-002"))).toBe(true);
  });
});

describe("all auth rules covered by dataset", () => {
  it("every rule in authRules has at least one matching dataset entry", () => {
    const authFixtures = (errorDataset as any[]).filter((f) => f.category === "auth");
    expect(authFixtures.length).toBeGreaterThanOrEqual(40);
    for (const rule of authRules) {
      const matched = authFixtures.some((f) => {
        try {
          return rule.match({ ...f.context, timestamp: Date.now() } as RequestContext);
        } catch {
          return false;
        }
      });
      expect(matched, `Rule ${rule.id} has no matching fixture`).toBe(true);
    }
  });
});
