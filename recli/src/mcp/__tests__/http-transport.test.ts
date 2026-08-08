import { describe, it, expect, afterEach } from "vitest";
import { createMcpHttpServer } from "../server.js";
import type { ExportBundle } from "../types.js";

function makeBundle(): ExportBundle {
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [
      {
        id: "col-1",
        name: "Test",
        description: "e2e",
        color: "blue",
        icon: "folder",
        folders: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        requests: [
          {
            id: "req-1",
            name: "Get Users",
            method: "GET",
            url: "https://httpbin.org/get",
            endpoint: "/get",
            headers: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            id: "req-2",
            name: "Post Data",
            method: "POST",
            url: "https://httpbin.org/post",
            endpoint: "/post",
            headers: { "Content-Type": "application/json" },
            body: '{"a":1}',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    ],
    environments: [],
  };
}

interface StartedServer {
  port: number;
  httpServer: import("node:http").Server;
  close(): void;
}

async function startServer(
  opts: { bundle?: ExportBundle; authToken?: string; enableJsonResponse?: boolean } = {},
): Promise<StartedServer> {
  const { httpServer, close } = await createMcpHttpServer({
    bundle: opts.bundle ?? makeBundle(),
    authToken: opts.authToken,
    corsOrigins: ["http://127.0.0.1"],
    allowLocalHosts: true,
    enableJsonResponse: opts.enableJsonResponse ?? true,
  });
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const addr = httpServer.address() as { port: number };
  return { port: addr.port, httpServer, close };
}

const ORIGIN = { origin: "http://127.0.0.1" };
const ACCEPT_JSON = "application/json, text/event-stream";

function post(port: number, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT_JSON, ...ORIGIN, ...extra },
    body: JSON.stringify(body),
  });
}

/** MCP initialize handshake. Returns session id (empty string if stateless). */
async function initialize(port: number, extra: Record<string, string> = {}): Promise<string> {
  const res = await post(
    port,
    {
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "recli-e2e", version: "1.0" },
      },
    },
    extra,
  );
  expect(res.status).toBe(200);
  // With enableJsonResponse, the response is JSON; session ID is in headers.
  const session = res.headers.get("mcp-session-id") ?? "";
  // Send initialized notification (session-id not required for notifications).
  await post(
    port,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { ...extra, ...(session ? { "mcp-session-id": session } : {}) },
  );
  return session;
}

// ── Auth token ──────────────────────────────────────────────────────────

describe("HTTP transport — bearer token auth", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("rejects 401 with no token, 401 with wrong token, and 200 with correct token", async () => {
    const { port, httpServer, close } = await startServer({ authToken: "secret123" });
    cleanup = () => {
      close();
      httpServer.close();
    };

    // No token → 401 (auth check runs before transport).
    const r1 = await post(port, { jsonrpc: "2.0", method: "tools/list", id: 1 });
    expect(r1.status).toBe(401);
    expect(r1.headers.get("www-authenticate")).toBe("Bearer");

    // Wrong token → 401.
    const r2 = await post(
      port,
      { jsonrpc: "2.0", method: "tools/list", id: 2 },
      { authorization: "Bearer wrong" },
    );
    expect(r2.status).toBe(401);

    // Correct token → 200. Initialize to get a valid session.
    const { port: p2, httpServer: h2, close: c2 } = await startServer({ authToken: "secret123" });
    const session = await initialize(p2, { authorization: "Bearer secret123" });
    const r3 = await post(
      p2,
      { jsonrpc: "2.0", method: "tools/list", id: 3 },
      { authorization: "Bearer secret123", ...(session ? { "mcp-session-id": session } : {}) },
    );
    expect(r3.status).toBe(200);
    const body = (await r3.json()) as any;
    expect(body.result.tools).toBeDefined();
    expect(body.result.tools.length).toBeGreaterThan(0);
    c2();
    h2.close();
  });

  it("OPTIONS preflight succeeds without token", async () => {
    const { port, httpServer, close } = await startServer({ authToken: "secret123" });
    cleanup = () => {
      close();
      httpServer.close();
    };
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "OPTIONS", headers: ORIGIN });
    expect(r.status).toBe(200);
  });
});

// ── Origin check ────────────────────────────────────────────────────────

describe("HTTP transport — CORS origin check", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("rejects requests with no Origin header (403)", async () => {
    const { port, httpServer, close } = await startServer();
    cleanup = () => {
      close();
      httpServer.close();
    };
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_JSON },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("Origin not allowed");
  });
});

// ── Full handshake + tool call ──────────────────────────────────────────

describe("HTTP transport — handshake + tools/list", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("lists tools after the MCP handshake", async () => {
    const { port, httpServer, close } = await startServer();
    cleanup = () => {
      close();
      httpServer.close();
    };
    const session = await initialize(port);
    const res = await post(
      port,
      { jsonrpc: "2.0", method: "tools/list", id: 2 },
      session ? { "mcp-session-id": session } : {},
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.tools.length).toBeGreaterThan(0);
  });
});
