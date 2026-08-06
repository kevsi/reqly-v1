/**
 * End-to-end tests for the real CLI binary (`recli run/validate/serve`).
 *
 * Spawns `node --import tsx src/index.ts` as a subprocess against a local
 * mock HTTP server, exercising the full pipeline: commander parsing â†’
 * runner â†’ reporters â†’ exit codes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = [process.execPath, "--import", "tsx", "src/index.ts"];

// â”€â”€ Mock HTTP server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let server: http.Server;
let baseUrl = "";
let hitCount = 0;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hitCount++;
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/posts") {
      return json(res, 200, [{ id: 1, title: "hello", userId: 1 }]);
    }
    if (req.method === "GET" && url.pathname === "/posts/1") {
      return json(res, 200, { id: 1, title: "hello", userId: 1 });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/error") {
      return json(res, 500, { error: "boom" });
    }
    if (req.method === "POST" && url.pathname === "/echo") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => json(res, 201, { echoed: raw }));
      return;
    }
    return json(res, 404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let tmpDir: string;
let fixture: string;

function makeFixture(requests: unknown[]): string {
  const bundle = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [{ name: "E2E", requests }],
    environments: [
      {
        name: "local",
        variables: [
          { key: "BASE_URL", value: baseUrl, enabled: true },
          { key: "DEMO_TOKEN", value: "secret-token", enabled: true },
        ],
      },
    ],
  };
  fixture = path.join(tmpDir, "collection.json");
  fs.writeFileSync(fixture, JSON.stringify(bundle, null, 2));
  return fixture;
}

function runCli(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(CLI[0]!, CLI.slice(1).concat(args), {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e) });
    });
  });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-e2e-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// â”€â”€ `recli run` â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("recli run (e2e)", () => {
  it("runs a collection against a live server and reports 2/2 passed", async () => {
    const file = makeFixture([
      {
        name: "List posts",
        method: "GET",
        url: "{{BASE_URL}}/posts",
        endpoint: "/posts",
        assert: [{ name: "status is 200", expr: "status == 200" }],
      },
      {
        name: "Health",
        method: "GET",
        url: "{{BASE_URL}}/health",
        endpoint: "/health",
        assert: [{ name: "ok", expr: "body.ok == true" }],
      },
    ]);
    const { code, stdout } = await runCli([
      "run",
      file,
      "--env",
      "local",
      "--allow-local-hosts",
      "--no-color",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("2 passed");
    expect(stdout).toContain("/posts");
    expect(stdout).toContain("/health");
  });

  it("exits 1 when an assertion fails", async () => {
    const file = makeFixture([
      {
        name: "Broken",
        method: "GET",
        url: "{{BASE_URL}}/error",
        endpoint: "/error",
        assert: [{ name: "status is 200", expr: "status == 200" }],
      },
    ]);
    const { code, stdout } = await runCli([
      "run",
      file,
      "--env",
      "local",
      "--allow-local-hosts",
      "--no-color",
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain("0 passed, 1 failed");
  });

  it("outputs machine-readable JSON lines with --json", async () => {
    const file = makeFixture([
      { name: "Health", method: "GET", url: "{{BASE_URL}}/health", endpoint: "/health" },
    ]);
    const { code, stdout } = await runCli([
      "run",
      file,
      "--env",
      "local",
      "--allow-local-hosts",
      "--json",
    ]);
    expect(code).toBe(0);
    const lines = stdout
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("{"));
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]!) as { name: string; status: number; passed: boolean };
    expect(first.name).toBe("Health");
    expect(first.status).toBe(200);
    expect(first.passed).toBe(true);
  });

  it("runs a single request with --request <name>", async () => {
    const file = makeFixture([
      { name: "List posts", method: "GET", url: "{{BASE_URL}}/posts", endpoint: "/posts" },
      { name: "Health", method: "GET", url: "{{BASE_URL}}/health", endpoint: "/health" },
    ]);
    const before = hitCount;
    const { code, stdout } = await runCli([
      "run",
      file,
      "--env",
      "local",
      "--allow-local-hosts",
      "--request",
      "Health",
      "--no-color",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("/health");
    expect(stdout).not.toContain("/posts");
    expect(hitCount).toBe(before + 1); // only one request hit the server
  });

  it("errors with a clear message on a missing file and exits non-zero", async () => {
    const { code, stderr } = await runCli(["run", path.join(tmpDir, "nope.json"), "--no-color"]);
    expect(code).toBe(1);
    expect(stderr + "").toMatch(/not found/i);
  });

  it("resolves {{vars}} from the selected environment", async () => {
    const file = makeFixture([
      {
        name: "Auth echo",
        method: "POST",
        url: "{{BASE_URL}}/echo",
        endpoint: "/echo",
        headers: { Authorization: "Bearer {{DEMO_TOKEN}}" },
        bodyType: "json",
        body: '{"x":1}',
        assert: [{ name: "created", expr: "status == 201" }],
      },
    ]);
    const { code } = await runCli([
      "run",
      file,
      "--env",
      "local",
      "--allow-local-hosts",
      "--no-color",
    ]);
    expect(code).toBe(0);
  });
});

// â”€â”€ `recli validate` â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("recli validate (e2e)", () => {
  it("accepts a valid bundle", async () => {
    const file = makeFixture([
      { name: "Health", method: "GET", url: "{{BASE_URL}}/health", endpoint: "/health" },
    ]);
    const { code, stdout } = await runCli(["validate", file]);
    expect(code).toBe(0);
    expect(stdout).toContain("Valid export bundle");
  });

  it("rejects a malformed bundle", async () => {
    const bad = path.join(tmpDir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ version: "1.0", collections: [] }));
    const { code } = await runCli(["validate", bad]);
    expect(code).toBe(1);
  });
});

// â”€â”€ `recli serve` â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("recli serve (e2e)", () => {
  it("starts the MCP HTTP server and answers tools/list over JSON-RPC", async () => {
    const file = makeFixture([
      { name: "Health", method: "GET", url: "{{BASE_URL}}/health", endpoint: "/health" },
    ]);
    const port = 30000 + Math.floor(Math.random() * 20000);

    const child = spawn(
      CLI[0]!,
      CLI.slice(1).concat([
        "serve",
        "--file",
        file,
        "--port",
        String(port),
        "--token",
        "e2e-token",
      ]),
      { cwd: REPO_ROOT, env: { ...process.env, NO_COLOR: "1" } },
    );

    let booted = "";
    const bootedP = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("serve did not boot")), 15000);
      const onData = (d: Buffer | string): void => {
        booted += d;
        if (booted.includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("close", () => reject(new Error("serve exited early")));
    });

    try {
      await bootedP;

      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer e2e-token",
        origin: "http://127.0.0.1",
      };
      const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "e2e", version: "1" },
          },
        }),
      });
      expect(init.status).toBe(200);
      const session = init.headers.get("mcp-session-id") ?? "";
      if (session) headers["mcp-session-id"] = session;

      const list = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const body = await list.text();
      expect(list.status).toBe(200);
      expect(body).toContain("run_request");
      expect(body).toContain("get_collection");
    } finally {
      child.kill("SIGKILL");
    }
  }, 30000);
});
