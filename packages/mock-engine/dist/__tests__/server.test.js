import { afterAll, describe, it, expect } from "vitest";
import { createMockServer } from "./index.js";
const handles = [];
async function start(config) {
    const handle = createMockServer(config);
    await new Promise((resolve) => {
        handle.server.listen(0, "127.0.0.1", resolve);
    });
    handles.push(handle);
    return { base: `http://127.0.0.1:${handle.port()}`, handle };
}
afterAll(async () => {
    await Promise.all(handles.map((h) => h.close()));
});
const baseConfig = {
    version: 1,
    cors: true,
    routes: [
        {
            id: "hello",
            method: "GET",
            path: "/hello/:name",
            responses: [
                {
                    id: "ok",
                    statusCode: 200,
                    headers: { "x-mock": "true" },
                    body: '{"hello":"{{request.path.name}}","page":"{{request.query.page}}"}',
                },
            ],
        },
        {
            id: "schema-users",
            method: "GET",
            path: "/api/users",
            responses: [
                {
                    id: "gen",
                    statusCode: 200,
                    schema: {
                        type: "object",
                        properties: {
                            email: { type: "string", format: "email" },
                            active: { type: "boolean" },
                            age: { type: "integer", min: 18, max: 99 },
                            role: { type: "string", enum: ["admin", "user"] },
                        },
                        required: ["email", "active", "age", "role"],
                    },
                },
            ],
        },
        {
            id: "pay",
            method: "POST",
            path: "/pay",
            responses: [
                {
                    id: "declined",
                    statusCode: 402,
                    rules: [{ target: "body", name: "amount", op: "regex", value: "^\\d{5,}$" }],
                    body: '{"declined":true}',
                },
                { id: "ok", statusCode: 200, body: '{"ok":true}' },
            ],
            transform: "if (body.echo) { return { echoed: body.echo, via: 'transform' }; }\nreturn JSON.parse(request_raw_placeholder_unused ?? 'null') ?? body;",
            meta: {},
        },
        {
            id: "slow",
            method: "GET",
            path: "/slow",
            responses: [{ id: "ok", statusCode: 200, body: '{"slow":true}' }],
            latency: { minMs: 80, maxMs: 80 },
        },
        {
            id: "flaky",
            method: "GET",
            path: "/flaky",
            responses: [{ id: "ok", statusCode: 200, body: '{"flaky":true}' }],
            failure: { probability: 0.5, kind: "status", statusCode: 500 },
        },
        {
            id: "stateful-items",
            method: "GET",
            path: "/items/:id",
            responses: [{ id: "ok", statusCode: 200 }],
            stateful: { enabled: true, resource: "items" },
        },
        {
            id: "stateful-create",
            method: "POST",
            path: "/items",
            responses: [
                {
                    id: "created",
                    statusCode: 201,
                    schema: {
                        type: "object",
                        properties: {
                            label: { type: "string", format: "slug" },
                            score: { type: "number", format: "price" },
                        },
                    },
                },
            ],
            stateful: { enabled: true, resource: "items" },
        },
        {
            id: "stateful-update",
            method: "PATCH",
            path: "/items/:id",
            responses: [{ id: "updated", statusCode: 200 }],
            stateful: { enabled: true, resource: "items" },
        },
        {
            id: "stateful-delete",
            method: "DELETE",
            path: "/items/:id",
            responses: [{ id: "deleted", statusCode: 200 }],
            stateful: { enabled: true, resource: "items" },
        },
    ],
};
describe("mock server (real HTTP)", () => {
    it("serves templated static bodies with path/query injection + custom headers", async () => {
        const { base } = await start(baseConfig);
        const res = await fetch(`${base}/hello/world?page=7`);
        expect(res.status).toBe(200);
        expect(res.headers.get("x-mock")).toBe("true");
        const body = (await res.json());
        expect(body.hello).toBe("world");
        expect(body.page).toBe("7");
    });
    it("generates realistic schema-compliant data", async () => {
        const { base } = await start(baseConfig);
        for (let i = 0; i < 5; i++) {
            const body = (await (await fetch(`${base}/api/users`)).json());
            expect(String(body.email)).toMatch(/@example\.com$/);
            expect([true, false]).toContain(body.active);
            expect(body.age).toBeGreaterThanOrEqual(18);
            expect(["admin", "user"]).toContain(body.role);
        }
    });
    it("selects conditional responses by body rule and applies transforms", async () => {
        const { base } = await start({
            ...baseConfig,
            routes: baseConfig.routes.map((r) => r.id === "pay"
                ? { ...r, transform: "return { echoed: body.echo, doubled: body.amount * 2 };" }
                : r),
        });
        // Rule match → declined (transform still applies at route level)
        const declined = await fetch(`${base}/pay`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount: 99999 }),
        });
        expect(declined.status).toBe(402);
        // Transform replaces the winning response body
        const ok = await fetch(`${base}/pay`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount: 10, echo: "ping" }),
        });
        const body = (await ok.json());
        expect(body.echoed).toBe("ping");
        expect(body.doubled).toBe(20);
    });
    it("respects latency bounds", async () => {
        const { base } = await start(baseConfig);
        const t0 = Date.now();
        await fetch(`${base}/slow`);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    });
    it("injects probabilistic failures", async () => {
        const { base } = await start(baseConfig);
        let failures = 0;
        for (let i = 0; i < 20; i++) {
            if ((await fetch(`${base}/flaky`)).status === 500)
                failures++;
        }
        expect(failures).toBeGreaterThan(2);
        expect(failures).toBeLessThan(18);
    });
    it("returns 501 with available endpoints for unmocked paths", async () => {
        const { base } = await start(baseConfig);
        const res = await fetch(`${base}/nope`);
        expect(res.status).toBe(501);
        const body = (await res.json());
        expect(body.error).toBe("not_mocked");
        expect(body.available.some((e) => e.path === "/hello/:name")).toBe(true);
    });
    it("runs stateful CRUD flows in-memory", async () => {
        const { base } = await start(baseConfig);
        // Create (schema shape merged with posted payload)
        const created = await fetch(`${base}/items`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: "custom-label" }),
        });
        expect(created.status).toBe(201);
        const item = (await created.json());
        expect(item.id).toBeTruthy();
        expect(item.label).toBe("custom-label"); // user override wins over generated
        expect(typeof item.score).toBe("number");
        // Read
        const got = await fetch(`${base}/items/${item.id}`);
        expect(got.status).toBe(200);
        expect((await got.json()).id).toBe(item.id);
        // Update
        const updated = await fetch(`${base}/items/${item.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: "renamed" }),
        });
        const updatedBody = (await updated.json());
        expect(updatedBody.label).toBe("renamed");
        expect(updatedBody.id).toBe(item.id); // id immutable
        // Missing read → 404
        expect((await fetch(`${base}/items/does-not-exist`)).status).toBe(404);
        // Delete
        expect((await fetch(`${base}/items/${item.id}`, { method: "DELETE" })).status).toBe(200);
        expect((await fetch(`${base}/items/${item.id}`)).status).toBe(404);
    });
    it("records requests and supports POST /mock/reset", async () => {
        const { base, handle } = await start(baseConfig);
        await fetch(`${base}/hello/reset-me`);
        expect(handle.recordings().length).toBeGreaterThan(0);
        expect(handle.recordings()[0]?.url).toBe("/hello/reset-me");
        await fetch(`${base}/mock/reset`, { method: "POST" });
        expect(handle.recordings()).toHaveLength(0);
    });
    it("supports hot config replacement without restart", async () => {
        const { base, handle } = await start(baseConfig);
        expect((await fetch(`${base}/v2/only`)).status).toBe(501);
        handle.replaceConfig({
            ...baseConfig,
            routes: [
                { id: "new", method: "GET", path: "/v2/only", responses: [{ id: "ok", statusCode: 200, body: '{"v2":true}' }] },
            ],
        });
        expect((await fetch(`${base}/v2/only`)).status).toBe(200);
    });
    it("strips basePath before matching and echoes CORS when enabled", async () => {
        const { base } = await start({ ...baseConfig, basePath: "/api/v2" });
        const res = await fetch(`${base}/api/v2/hello/from-base`);
        expect(res.status).toBe(200);
        expect((await res.json()).hello).toBe("from-base");
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
    it("produces malformed output when configured", async () => {
        const cfg = {
            version: 1,
            routes: [
                {
                    id: "broken",
                    method: "GET",
                    path: "/broken",
                    responses: [{ id: "ok", statusCode: 200 }],
                    failure: { probability: 1, kind: "malformed" },
                },
            ],
        };
        const { base } = await start(cfg);
        const text = await (await fetch(`${base}/broken`)).text();
        expect(text.startsWith('{"ok":')).toBe(true);
    });
    it("times out the socket on kind=timeout", async () => {
        const cfg = {
            version: 1,
            routes: [
                {
                    id: "hang",
                    method: "GET",
                    path: "/hang",
                    responses: [{ id: "ok", statusCode: 200 }],
                    failure: { probability: 1, kind: "timeout", timeoutMs: 150 },
                },
            ],
        };
        const { base } = await start(cfg);
        await expect(fetch(`${base}/hang`)).rejects.toThrow();
    });
});
//# sourceMappingURL=server.test.js.map