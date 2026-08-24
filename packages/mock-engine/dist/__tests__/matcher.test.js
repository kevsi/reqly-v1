import { describe, it, expect } from "vitest";
import { matchPath, findRoute, evaluateRule, selectResponse } from "./matcher.js";
describe("matchPath", () => {
    it("matches static paths", () => {
        expect(matchPath("/api/health", "/api/health")).toEqual({});
        expect(matchPath("/api/health", "/api/other")).toBeNull();
    });
    it("extracts :params", () => {
        const p = matchPath("/api/users/:id/posts/:postId", "/api/users/42/posts/7");
        expect(p).toEqual({ id: "42", postId: "7" });
    });
    it("decodes URI components in params", () => {
        expect(matchPath("/files/:name", "/files/a%20b.json")).toEqual({ name: "a b.json" });
    });
    it("supports trailing *splat", () => {
        const p = matchPath("/static/*splat", "/static/js/app/main.js");
        expect(p?.["splat"]).toBe("js/app/main.js");
    });
    it("rejects when splat has nothing to consume", () => {
        expect(matchPath("/static/*splat", "/static")).toBeNull();
    });
    it("rejects length mismatch without splat", () => {
        expect(matchPath("/a/b", "/a/b/c")).toBeNull();
        expect(matchPath("/a/b/c", "/a/b")).toBeNull();
    });
});
describe("findRoute", () => {
    const routes = [
        { id: "r1", method: "GET", path: "/users/:id", responses: [] },
        { id: "r2", method: "post", path: "/users", responses: [] },
    ];
    it("is case-insensitive on method", () => {
        expect(findRoute(routes, "POST", "/users")?.route.id).toBe("r2");
        expect(findRoute(routes, "get", "/users/9")?.route.id).toBe("r1");
    });
    it("returns null for unknown route/method combos", () => {
        expect(findRoute(routes, "DELETE", "/users/1")).toBeNull();
    });
});
describe("evaluateRule", () => {
    const ctx = {
        query: { page: "2" },
        headers: { "x-token": "abc123" },
        body: { user: { role: "admin", tags: ["beta"] }, note: "hello world" },
        rawBody: JSON.stringify({ user: { role: "admin", tags: ["beta"] }, note: "hello world" }),
    };
    it("query equals / exists / missing", () => {
        expect(evaluateRule({ target: "query", name: "page", op: "equals", value: "2" }, ctx)).toBe(true);
        expect(evaluateRule({ target: "query", name: "page", op: "exists" }, ctx)).toBe(true);
        expect(evaluateRule({ target: "query", name: "nope", op: "missing" }, ctx)).toBe(true);
    });
    it("header equals is case-insensitive on name and case-sensitive on value", () => {
        expect(evaluateRule({ target: "header", name: "X-Token", op: "equals", value: "abc123" }, ctx)).toBe(true);
        expect(evaluateRule({ target: "header", name: "X-Token", op: "equals", value: "ABC" }, ctx)).toBe(false);
    });
    it("body dot-path equals / exists / regex", () => {
        expect(evaluateRule({ target: "body", name: "user.role", op: "equals", value: "admin" }, ctx)).toBe(true);
        expect(evaluateRule({ target: "body", name: "user.email", op: "exists" }, ctx)).toBe(false);
        expect(evaluateRule({ target: "body", name: "user.role", op: "regex", value: "^ad" }, ctx)).toBe(true);
    });
    it("contains works on strings and arrays", () => {
        expect(evaluateRule({ target: "body", name: "note", op: "contains", value: "world" }, ctx)).toBe(true);
        expect(evaluateRule({ target: "body", name: "user.tags", op: "contains", value: "beta" }, ctx)).toBe(true);
    });
});
describe("selectResponse", () => {
    const route = {
        id: "r",
        method: "POST",
        path: "/pay",
        responses: [
            { id: "plain", statusCode: 200 },
            { id: "declined", statusCode: 402, rules: [{ target: "body", name: "amount", op: "regex", value: "^\\d{5,}$" }] },
            { id: "fallback", statusCode: 500 },
        ],
        defaultResponseId: "fallback",
    };
    const baseCtx = { query: {}, headers: {}, body: undefined, rawBody: "" };
    it("picks the rule-matching response first", () => {
        const picked = selectResponse(route, { ...baseCtx, body: { amount: 99999 }, rawBody: "{}" });
        expect(picked?.id).toBe("declined");
    });
    it("falls back to defaultResponseId then first", () => {
        expect(selectResponse(route, baseCtx)?.id).toBe("fallback");
        expect(selectResponse({ ...route, defaultResponseId: undefined }, baseCtx)?.id).toBe("plain");
    });
    it("returns null with no responses", () => {
        expect(selectResponse({ ...route, responses: [] }, baseCtx)).toBeNull();
    });
});
//# sourceMappingURL=matcher.test.js.map