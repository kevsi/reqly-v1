import { describe, it, expect } from "vitest";
import { generate, inferFormat } from "./generator.js";
import { resolveTemplate } from "./templating.js";
describe("inferFormat", () => {
    it("maps field names to formats", () => {
        expect(inferFormat("email")).toBe("email");
        expect(inferFormat("created_at")).toBe("date-time");
        expect(inferFormat("userId")).toBeUndefined();
        expect(inferFormat("price_total")).toBe("price");
    });
});
describe("generate", () => {
    it("generates format-compliant strings", () => {
        const email = generate({ type: "string", format: "email" }, Math.random);
        expect(email).toMatch(/@example\.com$/);
        const uuid = generate({ type: "string", format: "uuid" }, Math.random);
        expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    });
    it("infers from key name when schema is loose", () => {
        const v = generate({ type: "string" }, Math.random, "email");
        expect(v).toContain("@");
    });
    it("respects enum and example", () => {
        for (let i = 0; i < 20; i++) {
            expect(generate({ type: "string", enum: ["a", "b"] }, Math.random)).toMatch(/^[ab]$/);
        }
        expect(generate({ type: "integer", example: 7 }, Math.random)).toBe(7);
    });
    it("handles nested objects, required filtering and arrays with bounds", () => {
        const out = generate({
            type: "object",
            properties: {
                id: { type: "string", format: "uuid" },
                tags: { type: "array", items: { type: "string", format: "slug" }, minItems: 3, maxItems: 3 },
            },
            required: ["id", "tags"],
        }, Math.random);
        expect(Object.keys(out).sort()).toEqual(["id", "tags"]);
        expect(out["tags"]).toHaveLength(3);
    });
    it("honors numeric bounds", () => {
        const n = generate({ type: "number", min: 5, max: 10 }, Math.random);
        expect(n).toBeGreaterThanOrEqual(5);
        expect(n).toBeLessThanOrEqual(10);
    });
});
const ctx = {
    method: "POST",
    path: { id: "42" },
    query: { page: "2", q: "reqly" },
    headers: { "x-token": "secret-token" },
    body: { user: { name: "Alice" }, amount: 1500 },
    rawBody: "{}",
};
describe("resolveTemplate", () => {
    it("injects request values", () => {
        const out = resolveTemplate('{"userId":"{{request.path.id}}","page":"{{request.query.page}}","token":"{{request.header.x-token}}","who":"{{request.body.user.name}}"}', ctx);
        const parsed = JSON.parse(out);
        expect(parsed.userId).toBe("42");
        expect(parsed.page).toBe("2");
        expect(parsed.token).toBe("secret-token");
        expect(parsed.who).toBe("Alice");
    });
    it("resolves dynamic tokens", () => {
        const out = resolveTemplate('{"id":"{{uuid}}","n":"{{int 1 5}}","when":"{{nowIso}}"}', ctx);
        const parsed = JSON.parse(out);
        expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(Number(parsed.n)).toBeGreaterThanOrEqual(1);
        expect(Number(parsed.n)).toBeLessThanOrEqual(5);
        expect(new Date(parsed.when).getTime()).not.toBeNaN();
    });
    it("leaves unknown tokens untouched", () => {
        expect(resolveTemplate('{"x":"{{mystery}}"}', ctx)).toBe('{"x":"{{mystery}}"}');
    });
});
//# sourceMappingURL=generator.test.js.map