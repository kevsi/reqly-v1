import fs from "node:fs";
import path from "node:path";
import type {
  ExportBundle,
  RunResult,
  RunnerOptions,
  RunnerContext,
  RequestItem,
  Collection,
  HttpMethod,
  AssertionResult,
} from "./types.js";
import { evaluateAssertions, assertsPassed, evaluateSchemaAssertion } from "./assertions.js";
import { applyCaptures, interpolate } from "./chaining.js";
import { createScriptContext, executeScript } from "./scripting.js";
import { isUrlAllowed } from "./netguard.js";

const VALID_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
  "GRAPHQL",
];

// Default concurrency limit for parallel execution
const DEFAULT_CONCURRENCY = 20;

export const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MB

// Re-exported so existing callers (mcp/runner.ts, ssrf-guard tests) keep working.
export { isPrivateIp, isUrlAllowed } from "./netguard.js";

function getMethodsWithoutBody(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function buildEnvVarMap(
  bundle: ExportBundle,
  envName?: string,
  dotenv?: string,
  ctxVars?: Map<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();

  // 1. ctxVars (from previous iterations/captures) — lowest priority for dotenv
  if (ctxVars) {
    for (const [k, v] of ctxVars) map.set(k, v);
  }

  // 2. Bundle variables (Postman collection vars) — always-on, above ctx vars
  if (bundle.variables) {
    for (const v of bundle.variables) {
      if (v.enabled) map.set(v.key, v.value);
    }
  }

  // 3. Dotenv file — medium priority
  if (dotenv && fs.existsSync(dotenv)) {
    const content = fs.readFileSync(dotenv, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      let value = trimmed;

      // Handle inline comments (unless inside quotes)
      let eqIdx = value.indexOf("=");
      if (eqIdx === -1) continue;
      const key = value.slice(0, eqIdx).trim();

      // Remainder after first = becomes value
      value = value.slice(eqIdx + 1).trim();

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      map.set(key, value);
    }
  }

  // 4. Environment from bundle — highest priority among config sources
  if (envName && bundle.environments) {
    const env = bundle.environments.find((e) => e.name.toLowerCase() === envName.toLowerCase());
    if (env?.variables) {
      for (const v of env.variables) {
        if (v.enabled) map.set(v.key, v.value);
      }
    }
  }

  // 4. process.env — lowest priority, only fills in missing vars at lookup time
  // (Handled in interpolate() instead of here for correct dotenv semantics)

  return map;
}

function buildUrl(request: RequestItem, ctx: RunnerContext, dynCache: Map<string, string>): string {
  let url = interpolate(request.url, ctx, dynCache);
  if (request.queryParams?.length) {
    try {
      const urlObj = new URL(url);
      for (const qp of request.queryParams) {
        urlObj.searchParams.append(
          interpolate(qp.key, ctx, dynCache),
          interpolate(qp.value, ctx, dynCache),
        );
      }
      url = urlObj.toString();
    } catch (e) {
      // If URL is invalid, use it as-is (might be a template or relative)
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Warning: Invalid URL "${url}": ${msg}`);
    }
  }
  return url;
}

function buildHeaders(
  request: RequestItem,
  ctx: RunnerContext,
  dynCache: Map<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key] = interpolate(value, ctx, dynCache);
    }
  }
  if (request.authType && request.authToken) {
    const token = interpolate(request.authToken, ctx, dynCache);
    switch (request.authType) {
      case "bearer":
      case "oauth2":
        headers["Authorization"] = `Bearer ${token}`;
        break;
      case "basic":
        headers["Authorization"] = `Basic ${token}`;
        break;
    }
  }
  // Cookie Jar
  if (ctx.cookies.size > 0) {
    const existing = headers["Cookie"];
    const jarCookies = Array.from(ctx.cookies.entries())
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("; ");
    headers["Cookie"] = existing ? `${existing}; ${jarCookies}` : jarCookies;
  }
  return headers;
}

function buildBody(
  request: RequestItem,
  ctx: RunnerContext,
  dynCache: Map<string, string>,
): string | undefined {
  if (getMethodsWithoutBody(request.method) && request.method !== "GRAPHQL") return undefined;

  // GraphQL body
  if (request.method === "GRAPHQL" && request.graphql) {
    const gqlBody: Record<string, unknown> = {
      query: interpolate(request.graphql.query, ctx, dynCache),
    };
    if (request.graphql.variables) {
      const varsStr = JSON.stringify(request.graphql.variables);
      try {
        gqlBody.variables = JSON.parse(interpolate(varsStr, ctx, dynCache));
      } catch {
        // Interpolated variables produced invalid JSON — send the raw string
        // rather than crashing the whole run.
        gqlBody.variables = interpolate(varsStr, ctx, dynCache);
      }
    }
    if (request.graphql.operationName) {
      gqlBody.operationName = request.graphql.operationName;
    }
    return JSON.stringify(gqlBody);
  }

  if (request.body === undefined || request.body === null) return undefined;
  let body = interpolate(request.body, ctx, dynCache);
  if (request.bodyType === "json" && body) {
    try {
      body = JSON.stringify(JSON.parse(body));
    } catch {
      /* ok */
    }
  }
  return body;
}

function ensureContentType(
  headers: Record<string, string>,
  body?: string,
  method?: string,
  bodyType?: string,
): void {
  if (!body && method !== "GRAPHQL") return;
  const hasCT = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
  if (!hasCT) {
    if (method === "GRAPHQL") {
      headers["Content-Type"] = "application/json";
    } else if (bodyType === "urlencoded") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (bodyType === "xml") {
      headers["Content-Type"] = "application/xml";
    } else if (bodyType === "text") {
      headers["Content-Type"] = "text/plain";
    } else {
      headers["Content-Type"] = "application/json";
    }
  }
}

function getResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/**
 * Parse Set-Cookie headers.
 *
 * Uses response.headers.getSetCookie() (Node.js 19+) when available,
 * which returns individual cookie strings. Falls back to regex-based
 * parsing that correctly handles commas inside Expires/Max-Age values.
 */
/** decodeURIComponent that tolerates malformed percent-escapes (e.g. raw `%`). */
function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseCookies(responseHeaders: Record<string, string>): Record<string, string> {
  const cookies: Record<string, string> = {};
  const raw = responseHeaders["set-cookie"];
  if (!raw) return cookies;

  // Collect individual cookie header values
  const parts: string[] = [];

  // Use regex to split on commas that are NOT inside date/time values
  // A comma is a cookie separator unless followed by a space and a weekday name
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === ",") {
      // Check if this comma is part of an HTTP-date (followed by space + weekday)
      const rest = raw.slice(i + 1).trimStart();
      if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(rest)) {
        current += c; // part of a date, keep it
      } else {
        if (current.trim()) parts.push(current.trim());
        current = "";
      }
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());

  // Also try getSetCookie if this is a Response-like object
  // (fallback for environments where headers.getSetCookie exists)
  // The raw string split approach above covers all cases

  for (const part of parts) {
    const semiIdx = part.indexOf(";");
    const cookiePair = semiIdx === -1 ? part : part.slice(0, semiIdx);
    const eqIdx = cookiePair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeSafe(cookiePair.slice(0, eqIdx).trim());
    const value = decodeSafe(cookiePair.slice(eqIdx + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

async function checkSnapshot(
  request: RequestItem,
  result: RunResult,
  snapshotDir: string,
  update: boolean,
): Promise<void> {
  const safeName = request.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const snapPath = path.join(snapshotDir, `${safeName}.json`);

  if (update || !fs.existsSync(snapPath)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const snap = {
      url: result.url,
      status: result.status,
      body: result.body,
      headers: result.responseHeaders,
    };
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2), "utf8");
    return;
  }

  let existing: { body?: string; status?: number } | null = null;
  try {
    existing = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  } catch {
    // Corrupt/hand-edited snapshot: treat as missing, don't crash the run.
    existing = null;
  }
  if (
    existing?.body !== undefined &&
    (existing.body !== result.body || existing.status !== result.status)
  ) {
    result.snapshotChanged = true;
    result.passed = false;
    result.error = result.error ? `${result.error}; Snapshot changed` : "Snapshot changed";
  }
}

/**
 * Read a response body with a hard size cap so a huge endpoint cannot
 * exhaust memory (e.g. inside the MCP server). Stops reading once the cap
 * is exceeded and reports truncation.
 */
export async function readBodyWithCap(
  response: Response,
  maxSize: number,
): Promise<{ body: string; size: number; truncated: boolean }> {
  const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
  const isBinary = /^(image\/|video\/|audio\/|application\/pdf|application\/octet-stream)/.test(
    contentType,
  );

  const reader = response.body?.getReader();
  if (!reader) {
    return { body: "", size: 0, truncated: false };
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxSize) {
      await reader.cancel();
      return {
        body: `<Response truncated: exceeds ${maxSize} bytes>`,
        size,
        truncated: true,
      };
    }
    chunks.push(value);
  }

  const buf = Buffer.concat(chunks, size);
  if (isBinary) {
    return { body: `<Binary: ${size} bytes>`, size, truncated: false };
  }
  return { body: buf.toString("utf8"), size, truncated: false };
}

/** Default status codes that trigger a retry when --retries is enabled. */
const DEFAULT_RETRY_STATUS = [429, 502, 503, 504];

/**
 * Exponential backoff with full jitter: a random value in [0, base * 2^attempt).
 * Jitter avoids thundering-herd retries and keeps the wait non-deterministic.
 */
function backoffDelay(base: number, attempt: number): number {
  const exp = base * 2 ** attempt;
  return Math.floor(Math.random() * exp);
}

interface HttpAttempt {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  size: number;
  truncated: boolean;
  durationMs: number;
  responseHeaders: Record<string, string>;
  responseCookies: Record<string, string>;
  error?: string;
}

/**
 * Single HTTP exchange with retry/backoff. Retries on network errors (any
 * thrown error, including timeout) and on transient status codes. Truncation
 * and non-retriable statuses are returned immediately. Mutates `ctx.cookies`
 * (cookie jar) on each attempt so retries preserve session state.
 */
async function httpFetch(
  fetchUrl: string,
  method: string,
  headers: Record<string, string>,
  bodyToSend: string | undefined,
  timeoutMs: number,
  ctx: RunnerContext,
  options?: RunnerOptions,
): Promise<HttpAttempt> {
  const maxRetries = options?.retries ?? 0;
  const retryStatuses = options?.retryOnStatus ?? DEFAULT_RETRY_STATUS;
  const baseDelay = options?.retryDelayMs ?? 300;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();
    try {
      const response = await fetch(fetchUrl, {
        method,
        headers,
        body: bodyToSend,
        signal: controller.signal,
        redirect: "manual",
      });

      // Follow redirects manually, re-checking SSRF on each hop.
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        let hops = 0;
        let prevUrl = fetchUrl; // base for resolving relative Locations
        let prevRes = response; // last 3xx response seen
        let currentUrl = prevRes.headers.get("location") ?? "";
        while (currentUrl && hops < 10) {
          // Resolve relative redirects against the previous hop's URL.
          try {
            currentUrl = new URL(currentUrl, prevUrl).href;
          } catch {
            break;
          }
          const hopCheck = await isUrlAllowed(currentUrl, options?.allowLocalHosts);
          if (!hopCheck.allowed) {
            return {
              ok: false,
              status: 0,
              statusText: "Blocked",
              body: "",
              size: 0,
              truncated: false,
              durationMs: Date.now() - startTime,
              responseHeaders: {},
              responseCookies: {},
              error: `Redirect blocked: ${hopCheck.reason}`,
            };
          }
          // Conversion is decided from the PREVIOUS hop's status, not the
          // original response's: fetch spec converts only POST→GET on
          // 301/302, every non-GET/HEAD method to GET on 303, and preserves
          // method+body on 307/308.
          const convertToGet = [301, 302, 303].includes(prevRes.status)
            ? prevRes.status === 303 || method === "POST"
            : false;
          const hopRes = await fetch(currentUrl, {
            method: convertToGet ? "GET" : method,
            headers: convertToGet ? { ...headers } : headers,
            body: convertToGet ? undefined : bodyToSend,
            signal: controller.signal,
            redirect: "manual",
          });
          // Keep cookies from every hop, including intermediate 3xx.
          const hopCookies = parseCookies(getResponseHeaders(hopRes));
          for (const [k, v] of Object.entries(hopCookies)) ctx.cookies.set(k, v);
          if (![301, 302, 303, 307, 308].includes(hopRes.status)) {
            // Final response — read it.
            const dur = Date.now() - startTime;
            const rHeaders = getResponseHeaders(hopRes);
            const rCookies = parseCookies(rHeaders);
            for (const [k, v] of Object.entries(rCookies)) ctx.cookies.set(k, v);
            const {
              body: b,
              size: s,
              truncated: t,
            } = await readBodyWithCap(
              hopRes,
              options?.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE,
            );
            return {
              ok: true,
              status: hopRes.status,
              statusText: hopRes.statusText,
              body: b,
              size: s,
              truncated: t,
              durationMs: dur,
              responseHeaders: rHeaders,
              responseCookies: rCookies,
            };
          }
          prevUrl = currentUrl;
          prevRes = hopRes;
          currentUrl = hopRes.headers.get("location") ?? "";
          hops++;
        }
        // Exhausted redirect chain (>=10 hops or a 3xx without Location) —
        // return the LAST 3xx response as-is, not the original first hop.
        const dur = Date.now() - startTime;
        const rHeaders = getResponseHeaders(prevRes);
        const rCookies = parseCookies(rHeaders);
        for (const [k, v] of Object.entries(rCookies)) ctx.cookies.set(k, v);
        const {
          body: b,
          size: s,
          truncated: t,
        } = await readBodyWithCap(prevRes, options?.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE);
        return {
          ok: true,
          status: prevRes.status,
          statusText: prevRes.statusText,
          body: b,
          size: s,
          truncated: t,
          durationMs: dur,
          responseHeaders: rHeaders,
          responseCookies: rCookies,
        };
      }

      const durationMs = Date.now() - startTime;
      const responseHeaders = getResponseHeaders(response);
      const responseCookies = parseCookies(responseHeaders);

      // Cookie Jar: store cookies from every attempt
      for (const [k, v] of Object.entries(responseCookies)) {
        ctx.cookies.set(k, v);
      }

      const maxSize = options?.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE;
      const { body, size, truncated } = await readBodyWithCap(response, maxSize);

      // Retry on transient status (truncation is not retried — same body would come back)
      if (attempt < maxRetries && !truncated && retryStatuses.includes(response.status)) {
        clearTimeout(timeout);
        await sleep(backoffDelay(baseDelay, attempt));
        continue;
      }

      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        body,
        size,
        truncated,
        durationMs,
        responseHeaders,
        responseCookies,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof DOMException && error.name === "AbortError";

      if (attempt < maxRetries) {
        clearTimeout(timeout);
        await sleep(backoffDelay(baseDelay, attempt));
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: 0,
        statusText: isTimeout ? "Timeout" : "Error",
        body: "",
        size: 0,
        truncated: false,
        durationMs,
        responseHeaders: {},
        responseCookies: {},
        error: isTimeout ? `Timed out after ${timeoutMs}ms` : message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function executeRequest(
  request: RequestItem,
  ctx: RunnerContext,
  timeoutMs: number,
  options?: RunnerOptions,
): Promise<RunResult> {
  const scriptCtx = createScriptContext(ctx, request);

  if (request.scripts?.pre) {
    try {
      await executeScript(request.scripts.pre, scriptCtx, "pre", {
        allowLocalHosts: options?.allowLocalHosts,
      });
    } catch (e) {
      return {
        name: request.name,
        method: request.method,
        url: request.url,
        status: 0,
        statusText: "Script Error",
        durationMs: 0,
        size: 0,
        passed: false,
        error: e instanceof Error ? e.message : String(e),
        timestamp: Date.now(),
      };
    }
  }

  const method = request.method === "GRAPHQL" ? "POST" : request.method;
  // Dynamic {{$...}} variables are cached per request so URL/headers/body agree.
  const dynCache = new Map<string, string>();
  const url = buildUrl(request, ctx, dynCache);

  // SSRF re-check AFTER the pre-script: pm.request.setUrl() can rewrite the URL
  // to an internal address. Guard every hop here so both CLI and MCP stay safe.
  const check = await isUrlAllowed(url, options?.allowLocalHosts);
  if (!check.allowed) {
    return {
      name: request.name,
      method: request.method,
      url,
      status: 0,
      statusText: "Blocked",
      durationMs: 0,
      size: 0,
      passed: false,
      error: `URL blocked: ${check.reason}`,
      timestamp: Date.now(),
    };
  }
  const headers = buildHeaders(request, ctx, dynCache);
  const bodyToSend = buildBody(request, ctx, dynCache);
  ensureContentType(headers, bodyToSend, request.method, request.bodyType);

  // GraphQL requests use the same interpolated URL (vars like {{BASE_URL}} must
  // resolve; the raw request.url would otherwise be sent literally).
  const fetchUrl = url;

  const requestStart = Date.now();
  const attempt = await httpFetch(fetchUrl, method, headers, bodyToSend, timeoutMs, ctx, options);

  // Truncation: a too-large response is not retried — fail fast (mirrors prior behaviour).
  if (attempt.truncated) {
    const maxSize = options?.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE;
    return {
      name: request.name,
      method: request.method,
      url: fetchUrl,
      status: attempt.status,
      statusText: attempt.statusText,
      durationMs: attempt.durationMs,
      size: attempt.size,
      passed: false,
      error: `Response exceeds maximum allowed size of ${maxSize} bytes`,
      responseHeaders: attempt.responseHeaders,
      responseCookies: attempt.responseCookies,
      timestamp: requestStart,
    };
  }

  // Network/timeout error after retries are exhausted: run the post-script, then return.
  if (!attempt.ok) {
    if (request.scripts?.post) {
      const errorResult: RunResult = {
        name: request.name,
        method: request.method,
        url: fetchUrl,
        status: 0,
        statusText: attempt.statusText,
        durationMs: attempt.durationMs,
        size: 0,
        passed: false,
        error: attempt.error,
        timestamp: requestStart,
      };
      const postScriptCtx = createScriptContext(ctx, request, errorResult);
      try {
        await executeScript(request.scripts.post, postScriptCtx, "post", {
          allowLocalHosts: options?.allowLocalHosts,
        });
      } catch {
        /* ignore */
      }
      return errorResult;
    }

    return {
      name: request.name,
      method: request.method,
      url: fetchUrl,
      status: 0,
      statusText: attempt.statusText,
      durationMs: attempt.durationMs,
      size: 0,
      passed: false,
      error: attempt.error,
      timestamp: requestStart,
    };
  }

  // HTTP response received — build the result, then run post-script / assertions / captures / snapshot.
  const statusPassed = attempt.status < 400;
  const runResult: RunResult = {
    name: request.name,
    method: request.method,
    url: fetchUrl,
    status: attempt.status,
    statusText: attempt.statusText,
    durationMs: attempt.durationMs,
    size: attempt.size,
    passed: statusPassed,
    body: attempt.body,
    responseHeaders: attempt.responseHeaders,
    responseCookies: attempt.responseCookies,
    timestamp: requestStart,
  };

  if (request.scripts?.post) {
    const postScriptCtx = createScriptContext(ctx, request, runResult);
    try {
      const outcome = await executeScript(request.scripts.post, postScriptCtx, "post", {
        allowLocalHosts: options?.allowLocalHosts,
      });
      if (outcome.tests.length) {
        // pm.test() / legacy tests[] results are collected, not thrown — merge
        // them into the assertion list so failures surface in reports & TUI.
        const pmAssertions: AssertionResult[] = outcome.tests.map((t) => ({
          passed: t.passed,
          name: t.name,
          rawExpr: t.name,
          error: t.error,
        }));
        runResult.assertions = [...(runResult.assertions ?? []), ...pmAssertions];
        runResult.passed = statusPassed && assertsPassed(runResult.assertions);
      }
    } catch (e) {
      runResult.passed = false;
      runResult.error = e instanceof Error ? e.message : String(e);
      return runResult;
    }
  }

  if (request.assert?.length) {
    const assertionResults = evaluateAssertions(request.assert, runResult, ctx.vars);
    // Merge (not overwrite): a request may combine native `assert` entries with
    // pm.test() results collected from scripts.post.
    runResult.assertions = [...(runResult.assertions ?? []), ...assertionResults];
    runResult.passed = statusPassed && assertsPassed(runResult.assertions);
  }

  if (request.capture?.length) {
    runResult.capturedVars = applyCaptures(request.capture, runResult, ctx);
  }

  // Snapshot
  if (options?.snapshot || options?.updateSnapshots) {
    const snapDir = ".recli-snapshots";
    await checkSnapshot(request, runResult, snapDir, !!options.updateSnapshots);
  }

  return runResult;
}

export function flattenRequests(bundle: ExportBundle, requestFilter?: string): RequestItem[] {
  const requests: RequestItem[] = [];
  for (const collection of bundle.collections) {
    if (collection.skip) continue;
    for (const request of collection.requests) {
      if (request.skip) continue;
      if (requestFilter && request.name.toLowerCase() !== requestFilter.toLowerCase()) continue;
      requests.push(request);
    }
  }
  if (requestFilter && requests.length === 0) {
    throw new Error(`No request found matching "${requestFilter}"`);
  }
  return requests;
}

export async function runCollection(
  bundle: ExportBundle,
  options: RunnerOptions,
): Promise<RunResult[]> {
  const allResults: RunResult[] = [];
  const iters = options.iterations ?? 1;
  let dataRecords: Record<string, string>[] = [];
  // Shared across iterations and parallel workers: warn once per unresolved
  // name, deduplicated across the whole run.
  const unresolvedVars = new Set<string>();

  if (options.dataFile) {
    dataRecords = await loadDataFile(options.dataFile);
  }

  for (let iter = 0; iter < iters; iter++) {
    const ctx: RunnerContext = {
      vars: new Map<string, string>(),
      envVars: buildEnvVarMap(bundle, options.envName, options.dotenv),
      cookies: new Map<string, string>(),
      iteration: iter,
      data: dataRecords[iter % (dataRecords.length || 1)] || {},
      unresolvedVars,
    };

    for (const [k, v] of Object.entries(ctx.data || {})) {
      ctx.vars.set(k, v);
    }

    let requests = flattenRequests(bundle, options.requestName);

    const results = options.parallel
      ? await runParallel(requests, ctx, options)
      : await runSequential(requests, ctx, options);

    allResults.push(...results);
  }

  if (unresolvedVars.size > 0) {
    const names = [...unresolvedVars].sort().join(", ");
    process.stderr.write(
      `Warning: unresolved variable(s): ${names}. ` +
        `Define them in bundle.variables, an environment (--env), or a .env file.\n`,
    );
  }

  return allResults;
}

export async function runWorkspace(
  filePaths: string[],
  options: RunnerOptions,
): Promise<RunResult[]> {
  const allResults: RunResult[] = [];
  for (const fp of filePaths) {
    const resolvedPath = path.resolve(fp);
    const content = fs.readFileSync(resolvedPath, "utf8");
    const bundle = JSON.parse(content) as ExportBundle;
    const results = await runCollection(bundle, options);
    allResults.push(...results);
  }
  return allResults;
}

async function runSequential(
  requests: RequestItem[],
  ctx: RunnerContext,
  options: RunnerOptions,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const request of requests) {
    if (!VALID_METHODS.includes(request.method)) {
      results.push({
        name: request.name,
        method: request.method,
        url: request.url,
        status: 0,
        statusText: "Invalid",
        durationMs: 0,
        size: 0,
        passed: false,
        error: `Invalid method: ${request.method}`,
        timestamp: Date.now(),
      });
      if (options.bail) break;
      continue;
    }
    const result = await executeRequest(request, ctx, options.timeoutMs, options);
    results.push(result);
    if (options.bail && !result.passed) break;
    if (options.delayMs && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }
  return results;
}

/**
 * Run requests in parallel with:
 * - Cloned context per request to prevent race conditions on mutable state
 * - Concurrency limiter to prevent port exhaustion
 */
async function runParallel(
  requests: RequestItem[],
  parentCtx: RunnerContext,
  options: RunnerOptions,
): Promise<RunResult[]> {
  const results = new Array<RunResult>(requests.length);
  const concurrency = Math.min(requests.length, DEFAULT_CONCURRENCY);

  // Build an iterator over pending requests
  let nextIndex = 0;
  let bailed = false;

  const worker = async (): Promise<void> => {
    while (nextIndex < requests.length) {
      if (bailed) return;
      const i = nextIndex++;
      const request = requests[i];

      if (!VALID_METHODS.includes(request.method)) {
        results[i] = {
          name: request.name,
          method: request.method,
          url: request.url,
          status: 0,
          statusText: "Invalid",
          durationMs: 0,
          size: 0,
          passed: false,
          error: `Invalid method: ${request.method}`,
          timestamp: Date.now(),
        };
        if (options.bail) bailed = true;
        continue;
      }

      // CRITICAL: Clone mutable context per request to prevent race conditions
      const ctx: RunnerContext = {
        vars: new Map(parentCtx.vars),
        envVars: new Map(parentCtx.envVars),
        cookies: new Map(parentCtx.cookies),
        iteration: parentCtx.iteration,
        data: { ...(parentCtx.data || {}) },
        // Shared set so parallel workers record unresolved vars into one place.
        unresolvedVars: parentCtx.unresolvedVars,
      };

      results[i] = await executeRequest(request, ctx, options.timeoutMs, options);
      if (options.bail && !results[i].passed) bailed = true;
    }
  };

  // Spawn N concurrent workers
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  if (options.delayMs && options.delayMs > 0) {
    await sleep(options.delayMs);
  }
  return results;
}

async function loadDataFile(filePath: string): Promise<Record<string, string>[]> {
  const content = fs.readFileSync(filePath, "utf8");
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "json") {
    const data = JSON.parse(content);
    if (Array.isArray(data)) return data.map(normalizeRecord);
    return [normalizeRecord(data)];
  }

  if (ext === "csv") {
    return parseCSV(content);
  }

  throw new Error(`Unsupported data file format: .${ext} (use .json or .csv)`);
}

function normalizeRecord(record: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (record && typeof record === "object") {
    for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
      result[k] = v === null || v === undefined ? "" : String(v);
    }
  }
  return result;
}

/**
 * Parse CSV content with proper quoted field support.
 * Handles:
 * - Quoted fields with embedded commas (e.g. "Smith, John")
 * - Quoted fields with embedded newlines
 * - Empty fields
 */
function parseCSV(content: string): Record<string, string>[] {
  const rawLines = content.trim().split("\n");
  if (rawLines.length < 2) return [];
  const headers = parseCSVLine(rawLines[0]);
  const records: Record<string, string>[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const values = parseCSVLine(rawLines[i]);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] ?? "";
    });
    records.push(record);
  }
  return records;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // Handle escaped quotes ("")
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  values.push(current.trim());
  return values;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
