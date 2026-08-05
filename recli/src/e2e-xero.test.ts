/**
 * End-to-end regression on a real Postman collection (Xero's official OAuth 2.0
 * collection, kept in test/fixtures): import → rewrite to a local OAuth2 mock →
 * run. Proves the legacy postman.* API, pm.sendRequest token dances (formdata,
 * awaited before the main request), env-scope resolution, and the SSRF guard
 * (allowLocalHosts) all work together on unmodified real-world scripts.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePostmanCollection } from "./postman-import.js";
import { runCollection } from "./runner.js";
import { validateExportBundle } from "./validator.js";
import type { ExportBundle } from "./types.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "xero.postman_collection.json",
);

// ── local OAuth2 mock (same origin for the token + API endpoints) ──────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (url.pathname === "/connect/token" && req.method === "POST") {
      const form = new URLSearchParams(raw);
      if (form.get("grant_type") !== "refresh_token")
        return send(400, { error: "unsupported_grant_type" });
      if (!form.get("client_id") || !form.get("client_secret") || !form.get("refresh_token")) {
        return send(400, { error: "invalid_request" });
      }
      return send(200, {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.pathname === "/connections" && req.method === "GET") {
      if (!bearer) return send(401, { error: "unauthorized" });
      return send(200, [{ TenantId: "tenant-abc123", TenantName: "Demo Co" }]);
    }
    if (url.pathname === "/api.xro/2.0/Invoices" && req.method === "GET") {
      if (!bearer) return send(401, { error: "invalid_token" });
      if (!req.headers["xero-tenant-id"]) return send(400, { error: "missing tenant" });
      return send(200, { Invoices: [{ InvoiceID: "inv-0001", Status: "DRAFT" }] });
    }
    send(404, { error: "not_found" });
  });
});

const portPromise = new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    resolve((server.address() as { port: number }).port);
  });
});

afterAll(() => {
  server.close();
});

describe("e2e: Xero collection import → run against local OAuth2 mock", () => {
  it("runs the imported bundle with the real pm.* scripts (3 passed, 1 no-token)", async () => {
    const port = await portPromise;
    const origin = `http://127.0.0.1:${port}`;

    // Import the real collection, rewrite the Xero origins to the mock, and
    // supply the Postman environment (client_id/client_secret/refresh_token).
    const raw = parsePostmanCollection(fs.readFileSync(FIXTURE, "utf8"));
    const bundle = JSON.parse(
      JSON.stringify(raw)
        .replace(/https:\/\/api\.xero\.com/g, origin)
        .replace(/https:\/\/identity\.xero\.com/g, origin),
    ) as ExportBundle;
    bundle.environments = [
      {
        name: "OAuth 2.0",
        variables: [
          { key: "client_id", value: "e2e-client-id", enabled: true },
          { key: "client_secret", value: "e2e-client-secret", enabled: true },
          { key: "refresh_token", value: "e2e-refresh-token", enabled: true },
          { key: "access_token", value: "mock-access-token", enabled: true },
        ],
      },
    ];

    expect(validateExportBundle(bundle)).toEqual([]);

    const results = await runCollection(bundle, {
      envName: "OAuth 2.0",
      timeoutMs: 10000,
      allowLocalHosts: true,
    });

    const byName = Object.fromEntries(results.map((r) => [r.name, r]));

    // Get started ships an empty OAuth2 token (Postman UI would have filled it)
    // — the importer drops it, so the request goes out without Authorization and
    // the mock answers 401. That is the expected, faithful edge case.
    expect(byName["Get started"].passed).toBe(false);
    expect(byName["Get started"].status).toBe(401);

    // Connections: Bearer {{access_token}} interpolated from the environment,
    // legacy postman.setEnvironmentVariable + tests[] collected as assertions.
    expect(byName["Connections"].passed).toBe(true);
    expect(byName["Connections"].assertions?.map((a) => a.name ?? "")).toContain(
      "xero-tenant-id: tenant-abc123",
    );

    // Invoices: the pre-request pm.sendRequest token dance (formdata, callback)
    // must complete before the main request interpolates {{access_token}}.
    expect(byName["Invoices"].passed).toBe(true);

    // Refresh token: formdata POST + legacy test assertion.
    expect(byName["Refresh token"].passed).toBe(true);
    expect(
      byName["Refresh token"].assertions?.some((a) => (a.name ?? "").includes("Access Token")),
    ).toBe(true);

    expect(results.filter((r) => r.passed)).toHaveLength(3);
  });
});
