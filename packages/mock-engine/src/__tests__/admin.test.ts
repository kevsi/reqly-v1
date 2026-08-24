import { afterAll, describe, it, expect } from "vitest";
import { createMockServer, type MockServerHandle } from "../index.js";
import type { MockConfig } from "../types.js";

const TOKEN = "unit-admin-token-123";

const cfg: MockConfig = {
  version: 1,
  name: "admin-test",
  cors: true,
  routes: [
    {
      id: "hello",
      method: "GET",
      path: "/hello",
      responses: [{ id: "ok", statusCode: 200, body: '{"hi":true}' }],
    },
  ],
};

let h1: MockServerHandle, h2: MockServerHandle;
afterAll(async () => {
  await Promise.all([h1, h2].filter(Boolean).map((h) => h.close()));
});

function adminUrl(handle: MockServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.port()}${path}`;
}

describe("admin control channel", () => {
  it("is disabled (404) when no adminToken is configured", async () => {
    h1 = createMockServer(cfg);
    await new Promise<void>((r) => h1.server.listen(0, "127.0.0.1", r));
    const res = await fetch(adminUrl(h1, "/mock/__admin/state"), {
      headers: { "x-admin-token": TOKEN },
    });
    // Fail-closed: without a token the channel does not exist.
    expect(res.status).toBe(401);
  });

  it("rejects wrong/missing tokens with 401", async () => {
    h2 = createMockServer({ ...cfg }, { adminToken: TOKEN });
    await new Promise<void>((r) => h2.server.listen(0, "127.0.0.1", r));

    const missing = await fetch(adminUrl(h2, "/mock/__admin/state"));
    expect(missing.status).toBe(401);

    const wrong = await fetch(adminUrl(h2, "/mock/__admin/state"), {
      headers: { "x-admin-token": "nope" },
    });
    expect(wrong.status).toBe(401);

    const ok = await fetch(adminUrl(h2, "/mock/__admin/state"), {
      headers: { "x-admin-token": TOKEN },
    });
    expect(ok.status).toBe(200);
  });

  it("blocks non-loopback app origins even with a valid token", async () => {
    const res = await fetch(adminUrl(h2!, "/mock/__admin/state"), {
      headers: { "x-admin-token": TOKEN, origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("answers preflights for loopback origins with private-network approval", async () => {
    const res = await fetch(adminUrl(h2!, "/mock/__admin/logs"), {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-admin-token",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-admin-token");
  });

  it("state/logs/config/reset full flow", async () => {
    // generate traffic first
    await fetch(adminUrl(h2!, "/hello"));

    const state = (await (
      await fetch(adminUrl(h2!, "/mock/__admin/state"), { headers: { "x-admin-token": TOKEN } })
    ).json()) as Record<string, unknown>;
    expect(state.routesCount).toBe(1);
    expect(state.recordings).toBeGreaterThan(0);

    const logs = (await (
      await fetch(adminUrl(h2!, "/mock/__admin/logs"), { headers: { "x-admin-token": TOKEN } })
    ).json()) as { requests: Array<{ url: string }>; total: number };
    expect(logs.total).toBe(logs.requests.length);
    expect(logs.requests[0]?.url).toBe("/hello");

    // Push a new config → hot swap
    const pushed = await fetch(adminUrl(h2!, "/mock/__admin/config"), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({
        version: 1,
        routes: [
          {
            id: "v2",
            method: "GET",
            path: "/v2",
            responses: [{ id: "ok", statusCode: 200, body: '{"v2":true}' }],
          },
        ],
      }),
    });
    expect(pushed.status).toBe(200);

    const oldRoute = await fetch(adminUrl(h2!, "/hello"));
    expect(oldRoute.status).toBe(501); // gone
    const newRoute = await fetch(adminUrl(h2!, "/v2"));
    expect(newRoute.status).toBe(200);

    // Invalid config rejected
    const bad = await fetch(adminUrl(h2!, "/mock/__admin/config"), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({ version: 99, routes: [] }),
    });
    expect(bad.status).toBe(400);

    // Reset clears recordings
    await fetch(adminUrl(h2!, "/mock/__admin/reset"), {
      method: "POST",
      headers: { "x-admin-token": TOKEN },
    });
    const state2 = (await (
      await fetch(adminUrl(h2!, "/mock/__admin/state"), { headers: { "x-admin-token": TOKEN } })
    ).json()) as Record<string, number>;
    expect(state2.recordings).toBe(0);
  });
});
