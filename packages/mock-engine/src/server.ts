import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { findRoute, selectResponse } from "./matcher.js";
import { generate } from "./generator.js";
import { resolveTemplate } from "./templating.js";
import { MockStateStore, resourceFromPath } from "./state.js";
import { runTransform } from "./scripts.js";
import type {
  HttpMethod,
  MockConfig,
  MockRoute,
  RecordedRequest,
  RequestContext,
} from "./types.js";
import { MOCK_CONFIG_VERSION } from "./types.js";

export interface MockServerOptions {
  /** Called for every completed request (CLI logs, TUI, tests). */
  onRequest?: (record: RecordedRequest) => void;
  /** Cap on captured request/response bodies kept in memory. */
  maxRecordings?: number;
  /** Cap on incoming body size. Default 1 MB. */
  maxBodyBytes?: number;
  /**
   * Enables the control channel (/mock/__admin/*) protected by this token.
   * When absent the channel does not exist (fail-closed).
   */
  adminToken?: string;
  /** Extra origins allowed to call the admin channel (in addition to loopback apps + Tauri). */
  adminAllowedOrigins?: string[];
}

export interface MockServerHandle {
  server: http.Server;
  /** Swap the active config at runtime (hot reload without restart). */
  replaceConfig(next: MockConfig): void;
  /** Wipe the stateful store + recordings (POST /mock/reset does the same). */
  reset(): void;
  recordings(): readonly RecordedRequest[];
  close(): Promise<void>;
  /** Actual bound port (useful when config.port is 0). */
  port(): number | undefined;
}

const rng = Math.random;

function randBetween(min: number, max: number): number {
  return min === max ? min : Math.floor(rng() * (max - min + 1)) + min;
}

/** Timing-safe string comparison (hash both sides to avoid length leaks). */
function safeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const ADMIN_DEFAULT_ORIGINS = [
  "https://tauri.localhost",
  "http://tauri.localhost",
  "tauri://localhost",
];

/** Admin channel is reachable only by local apps (loopback origins) + Tauri. */
function adminOriginAllowed(origin: string, extra?: string[]): boolean {
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1")
      return true;
    if (ADMIN_DEFAULT_ORIGINS.includes(origin)) return true;
    return extra?.includes(origin) ?? false;
  } catch {
    return false;
  }
}

function preview(value: string, max = 2048): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

export function createMockServer(
  initialConfig: MockConfig,
  options: MockServerOptions = {},
): MockServerHandle {
  let config = initialConfig;
  const store = new MockStateStore();
  const recordings: RecordedRequest[] = [];
  const maxRecordings = options.maxRecordings ?? 500;
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;

  function availableEndpoints(): Array<{ method: string; path: string }> {
    return config.routes.map((r) => ({
      method: String(r.method).toUpperCase(),
      path: r.path,
    }));
  }

  function record(entry: RecordedRequest): void {
    recordings.push(entry);
    if (recordings.length > maxRecordings) recordings.shift();
    options.onRequest?.(entry);
  }

  function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!config.cors) return;
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] ?? "*",
    );
  }

  function sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders?: Record<string, string>,
  ): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      ...extraHeaders,
    });
    res.end(body);
  }

  async function readRawBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > maxBodyBytes) throw new Error("body_too_large");
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  function buildResponseBody(
    route: MockRoute,
    response: NonNullable<ReturnType<typeof selectResponse>>,
    ctx: RequestContext & { rawPath(): string },
    statefulResult: unknown | undefined,
  ): { body: string; scriptError?: string } {
    // Stateful routes produce their own payload.
    if (statefulResult !== undefined) {
      return { body: JSON.stringify(statefulResult) };
    }

    let bodyText: string;
    if (typeof response.body === "string") {
      bodyText = resolveTemplate(response.body, ctx);
    } else if (response.schema) {
      bodyText = JSON.stringify(generate(response.schema, rng));
    } else {
      bodyText = "{}";
    }

    if (route.transform) {
      try {
        const replaced = runTransform(route.transform, {
          request: {
            method: ctx.method,
            path: ctx.rawPath(),
            query: ctx.query,
            headers: ctx.headers,
          },
          body: ctx.body,
          state: undefined,
        });
        bodyText = typeof replaced === "string" ? replaced : JSON.stringify(replaced ?? null);
      } catch (err) {
        return {
          body: JSON.stringify({
            error: "mock_transform_error",
            message: err instanceof Error ? err.message : String(err),
          }),
          scriptError: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return { body: bodyText };
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "mock_internal", message: String(err) });
      } else {
        res.destroy();
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://mock.local");
    let pathname = decodeURIComponent(url.pathname);

    // ── Admin control channel (/mock/__admin/*) ──────────────────────────
    if (pathname.startsWith("/mock/__admin")) {
      const origin = req.headers.origin ?? null;
      // Browser requests always carry Origin → must be an allowed loopback/Tauri
      // app. Server-to-server callers (no Origin) skip this check and rely on
      // the token alone.
      const originAllowed =
        origin === null || adminOriginAllowed(origin, options.adminAllowedOrigins);

      // Strict preflight: disallowed origins are rejected outright.
      if (req.method === "OPTIONS") {
        if (!origin || !originAllowed || !options.adminToken) {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,PUT",
          "Access-Control-Allow-Headers": "content-type,x-admin-token",
          "Access-Control-Allow-Private-Network": "true",
          "Access-Control-Max-Age": "600",
        });
        res.end();
        return;
      }

      if (!originAllowed) {
        sendJson(res, 403, { error: "admin_origin_not_allowed" });
        return;
      }
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }

      // Fail-closed when no token was configured: the channel does not exist.
      const token = options.adminToken;
      const provided = req.headers["x-admin-token"] ?? "";
      if (!token || typeof provided !== "string" || !safeEqualStr(provided, token)) {
        sendJson(res, 401, { error: "invalid_admin_token" });
        return;
      }

      switch (`${pathname} ${req.method}`) {
        case "/mock/__admin/state GET":
          sendJson(res, 200, {
            name: config.name ?? null,
            version: config.version,
            routesCount: config.routes.length,
            recordings: recordings.length,
            cors: !!config.cors,
          });
          return;
        case "/mock/__admin/logs GET":
          sendJson(res, 200, { requests: recordings, total: recordings.length });
          return;
        case "/mock/__admin/reset POST":
          store.reset();
          recordings.length = 0;
          res.writeHead(204).end();
          return;
        case "/mock/__admin/config PUT": {
          let next: unknown;
          try {
            next = JSON.parse(await readRawBody(req));
          } catch {
            sendJson(res, 400, { error: "invalid_json" });
            return;
          }
          const cfg = next as MockConfig | undefined;
          if (!cfg || cfg.version !== MOCK_CONFIG_VERSION || !Array.isArray(cfg.routes)) {
            sendJson(res, 400, { error: "invalid_mock_config" });
            return;
          }
          config = cfg;
          sendJson(res, 200, { ok: true, routesCount: cfg.routes.length });
          return;
        }
        default:
          sendJson(res, 404, { error: "unknown_admin_endpoint" });
          return;
      }
    }

    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (config.basePath && pathname.startsWith(config.basePath)) {
      pathname = pathname.slice(config.basePath.length) || "/";
    }
    const rawPath = () => pathname;

    // Admin: reset state + recordings between test suites.
    if (pathname === "/mock/reset" && req.method === "POST") {
      store.reset();
      recordings.length = 0;
      res.writeHead(204);
      res.end();
      return;
    }

    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k.toLowerCase()] = v;
    }

    let rawBody = "";
    try {
      rawBody = await readRawBody(req);
    } catch {
      sendJson(res, 413, { error: "request_body_too_large" });
      return;
    }
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      parsedBody = rawBody || undefined;
    }

    const method = (req.method ?? "GET").toUpperCase() as Uppercase<HttpMethod>;
    const found = findRoute(config.routes, method, pathname);

    const finish = (
      status: number,
      body: string,
      matchedRouteId: string | null,
      note?: string,
      extraHeaders?: Record<string, string>,
    ): void => {
      const entry: RecordedRequest = {
        id: randomId(),
        at: started,
        method,
        url: pathname,
        matchedRouteId,
        responseStatus: status,
        durationMs: Date.now() - started,
        requestHeaders: headers,
        requestBodyPreview: rawBody ? preview(rawBody) : undefined,
        responseBodyPreview: body ? preview(body) : undefined,
        note,
      };
      record(entry);
      const headers_out = { "Content-Length": Buffer.byteLength(body), ...extraHeaders };
      res.writeHead(status, headers_out);
      if (method === "HEAD") res.end();
      else res.end(body);
    };

    if (!found) {
      finish(
        501,
        JSON.stringify({
          error: "not_mocked",
          message: "No mock configured for this endpoint.",
          available: availableEndpoints(),
        }),
        null,
        "no_route",
      );
      return;
    }

    const { route, params } = found;

    // Latency simulation (fixed or uniform range).
    if (route.latency) {
      const ms = randBetween(
        route.latency.minMs,
        Math.max(route.latency.minMs, route.latency.maxMs),
      );
      if (ms > 0) await sleep(ms);
    }

    // Chaos: probabilistic failures.
    if (route.failure && rng() < route.failure.probability) {
      const kind = route.failure.kind;
      if (kind === "status") {
        finish(
          route.failure.statusCode ?? 500,
          JSON.stringify({ error: "simulated_failure" }),
          route.id,
          `failure:${kind}`,
        );
        return;
      }
      if (kind === "timeout") {
        const entry: RecordedRequest = {
          id: randomId(),
          at: started,
          method,
          url: pathname,
          matchedRouteId: route.id,
          responseStatus: null,
          durationMs: Date.now() - started,
          requestHeaders: headers,
          note: `failure:timeout`,
        };
        record(entry);
        const timer = setTimeout(() => req.socket.destroy(), route.failure.timeoutMs ?? 10_000);
        timer.unref?.();
        res.on("close", () => clearTimeout(timer));
        return;
      }
      const entry: RecordedRequest = {
        id: randomId(),
        at: started,
        method,
        url: pathname,
        matchedRouteId: route.id,
        responseStatus: null,
        durationMs: Date.now() - started,
        requestHeaders: headers,
        note: `failure:${kind}`,
      };
      record(entry);
      if (kind === "reset") req.socket.destroy();
      else finish(200, '{"ok":', route.id, `failure:${kind}`); // malformed JSON
      return;
    }

    const response = selectResponse(route, { query, headers, body: parsedBody, rawBody });
    if (!response) {
      finish(
        500,
        JSON.stringify({ error: "misconfigured_route", routeId: route.id }),
        route.id,
        "no_response",
      );
      return;
    }

    const ctx: RequestContext & { rawPath(): string } = {
      method,
      path: params,
      query,
      headers,
      body: parsedBody,
      rawBody,
      rawPath,
    };

    // Stateful-lite CRUD before templating.
    let statefulResult: unknown | undefined;
    const stateful = route.stateful?.enabled
      ? {
          resource: resourceFromPath(route.path, route.stateful.resource),
          idField: route.stateful.idField ?? "id",
        }
      : null;
    if (stateful) {
      const idFromPath = params[stateful.idField];
      const patch =
        parsedBody && typeof parsedBody === "object" ? (parsedBody as Record<string, unknown>) : {};
      switch (method) {
        case "POST": {
          const shape = response.schema
            ? (generate(response.schema, rng) as Record<string, unknown>)
            : {};
          statefulResult = store.create(
            stateful.resource,
            { ...shape, ...patch },
            stateful.idField,
          );
          break;
        }
        case "GET":
          if (idFromPath) {
            const item = store.get(stateful.resource, idFromPath);
            if (!item) {
              finish(
                404,
                JSON.stringify({ error: "not_found", resource: stateful.resource, id: idFromPath }),
                route.id,
              );
            } else {
              statefulResult = item;
            }
          } else {
            const all = store.list(stateful.resource);
            // Empty bucket + a schema → serve a generated sample as preview
            // (nicer first-contact than a bare []).
            statefulResult =
              all.length > 0 || !response.schema ? all : [generate(response.schema, rng)];
          }
          break;
        case "PUT":
        case "PATCH":
          statefulResult = idFromPath
            ? (store.update(stateful.resource, idFromPath, patch, stateful.idField) ??
              finish(
                404,
                JSON.stringify({ error: "not_found", resource: stateful.resource, id: idFromPath }),
                route.id,
              ))
            : undefined;
          break;
        case "DELETE": {
          const ok = idFromPath ? store.delete(stateful.resource, idFromPath) : false;
          if (!ok) finish(404, JSON.stringify({ error: "not_found" }), route.id);
          else finish(200, JSON.stringify({ deleted: true, id: idFromPath }), route.id);
          return;
        }
      }
      if (res.writableEnded) return; // a 404 was already sent by the guard above
      if (statefulResult === null && (method === "GET" || method === "PUT" || method === "PATCH")) {
        // get/update miss already finished with 404; defensive early-return.
        if (res.writableEnded) return;
      }
    }

    const built = buildResponseBody(route, response, ctx, statefulResult);

    const extraHeaders: Record<string, string> = { ...response.headers };
    if (built.scriptError)
      extraHeaders["x-mock-script-error"] = encodeURIComponent(built.scriptError);
    const looksJson =
      built.body.trimStart().startsWith("{") || built.body.trimStart().startsWith("[");
    if (!extraHeaders["Content-Type"] && !extraHeaders["content-type"] && looksJson) {
      extraHeaders["Content-Type"] = "application/json";
    }

    finish(response.statusCode, built.body, route.id, undefined, extraHeaders);
  }

  server.keepAliveTimeout = 5000;

  return {
    server,
    replaceConfig(next: MockConfig) {
      config = next;
    },
    reset() {
      store.reset();
      recordings.length = 0;
    },
    recordings: () => [...recordings],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    port: () => {
      const addr = server.address() as AddressInfo | null;
      return addr && typeof addr === "object" ? addr.port : undefined;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let counter = 0;
function randomId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
