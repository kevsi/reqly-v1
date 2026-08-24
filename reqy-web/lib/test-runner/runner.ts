import { evaluateAssertions } from "./assertions";
import { runScript } from "./scripts";
import { isUnsafeObjectKey } from "@/lib/utils";
import type {
  CollectionRunReport,
  RequestResponse,
  RunnerContext,
  RequestTestResult,
  Assertion,
} from "./types";
import type { Collection, RequestItem } from "@/hooks/request-types";

export interface RunnerOptions {
  executor: (req: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }) => Promise<RequestResponse>;
  iterations?: RunnerContext[];
  perRequestTimeoutMs?: number;
  scriptTimeoutMs?: number;
  /** Security: never execute user scripts server-side (node:vm escape vector). */
  disableScripts?: boolean;
  /** Stops starting further requests and marks an active request as skipped. */
  signal?: AbortSignal;
  /** Stop execution immediately if a request fails or errors */
  stopOnFailure?: boolean;
  /** Delay in ms between requests (anti rate-limit) */
  delayMs?: number;
  /** Progress callback called when a single request completes */
  onRequestDone?: (completed: number, total: number, result: RequestTestResult) => void;
  /** Visual no-code variable extraction rules */
  extractions?: import("./types").VariableExtractionRule[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function moveItemInArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveItemById<T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string,
): T[] {
  const fromIndex = items.findIndex((item) => item.id === fromId);
  const toIndex = items.findIndex((item) => item.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return items;
  return moveItemInArray(items, fromIndex, toIndex);
}

export function buildIterationContexts(
  baseContext: RunnerContext,
  datasetRows: Record<string, string>[],
  iterationCount: number,
): RunnerContext[] {
  const safeCount = Math.max(1, Number.isFinite(iterationCount) ? iterationCount : 1);

  if (datasetRows.length > 0) {
    return datasetRows.map((row, idx) => ({
      environment: { ...baseContext.environment },
      iterationData: { ...row },
      iterationIndex: idx,
      log: baseContext.log,
    }));
  }

  return Array.from({ length: safeCount }, (_, idx) => ({
    environment: { ...baseContext.environment },
    iterationData: {
      ...baseContext.iterationData,
      iteration: String(idx + 1),
    },
    iterationIndex: idx,
    log: baseContext.log,
  }));
}

export async function runCollection(
  collection: Collection,
  baseContext: RunnerContext,
  options: RunnerOptions,
): Promise<CollectionRunReport> {
  const startedAt = Date.now();
  const contexts = options.iterations ?? [baseContext];
  const results: RequestTestResult[] = [];
  const totalRequests = collection.requests.length * contexts.length;
  let completedCount = 0;

  for (const ctx of contexts) {
    for (let i = 0; i < collection.requests.length; i++) {
      const req = collection.requests[i];
      if (options.signal?.aborted) break;

      const res = await runOne(req, ctx, options);
      results.push(res);
      completedCount++;
      options.onRequestDone?.(completedCount, totalRequests, res);

      if (options.stopOnFailure && (res.status === "fail" || res.status === "errored")) {
        break;
      }

      if (options.delayMs && options.delayMs > 0 && i < collection.requests.length - 1) {
        await sleep(options.delayMs);
      }
    }
    if (options.signal?.aborted) break;
    if (
      options.stopOnFailure &&
      results.some((r) => r.status === "fail" || r.status === "errored")
    ) {
      break;
    }
  }

  const completedAt = Date.now();
  return {
    collectionId: collection.id,
    collectionName: collection.name,
    startedAt,
    completedAt,
    totalDurationMs: completedAt - startedAt,
    results,
    summary: summarize(results),
  };
}

async function runOne(
  req: RequestItem,
  ctx: RunnerContext,
  options: RunnerOptions,
): Promise<RequestTestResult> {
  const result: RequestTestResult = {
    requestId: req.id,
    requestName: req.name,
    status: "skipped",
    assertionResults: [],
  };

  if (options.signal?.aborted) {
    result.error = "Execution annulée";
    return result;
  }

  // Pre script (disabled server-side — user JS is never executed)
  const preScript = options.disableScripts
    ? undefined
    : (req as unknown as { preRequestScript?: string }).preRequestScript;
  if (preScript) {
    const out = await runScript(preScript, ctx, {
      phase: "pre",
      timeoutMs: options.scriptTimeoutMs,
    });
    if (out.error) {
      result.status = "errored";
      result.error = `Pre-script error: ${out.error}`;
      return result;
    }
    result.scriptOutput = { ...(result.scriptOutput ?? {}), pre: out.consoleLines.join("\n") };
  }

  // HTTP
  let response: RequestResponse;
  try {
    response = await options.executor({
      method: req.method,
      url: interpolate(req.url, ctx),
      headers: headersToRecord(req.headers, ctx),
      body: req.body ? interpolate(req.body, ctx) : undefined,
    });
  } catch (err) {
    if (options.signal?.aborted) {
      result.status = "skipped";
      result.error = "Execution annulée";
      return result;
    }
    result.status = "errored";
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
  if (options.signal?.aborted) {
    result.status = "skipped";
    result.error = "Execution annulée";
    return result;
  }
  result.statusCode = response.statusCode;
  result.responseTimeMs = response.responseTimeMs;

  // Snapshot réponse pour les checks monitors (body/headers) hors assertions.
  try {
    const rawBody =
      typeof response.body === "string" ? response.body : JSON.stringify(response.body);
    if (rawBody) result.responseBodyPreview = rawBody.slice(0, 2048);
    const headerEntries = Object.entries(response.headers ?? {});
    if (headerEntries.length > 0) {
      const lower: Record<string, string> = {};
      for (const [k, v] of headerEntries) lower[k.toLowerCase()] = String(v);
      result.responseHeaders = lower;
    }
  } catch {
    /* snapshot best-effort */
  }

  // Post script (disabled server-side — user JS is never executed)
  const postScript = options.disableScripts
    ? undefined
    : (req as unknown as { postResponseScript?: string }).postResponseScript;
  if (postScript) {
    const out = await runScript(postScript, ctx, {
      phase: "post",
      response,
      timeoutMs: options.scriptTimeoutMs,
    });
    if (out.error) {
      result.status = "errored";
      result.error = `Post-script error: ${out.error}`;
      return result;
    }
    result.scriptOutput = { ...(result.scriptOutput ?? {}), post: out.consoleLines.join("\n") };
  }

  // Extractions (no-code visual variable extraction)
  if (options.extractions && options.extractions.length > 0) {
    for (const rule of options.extractions) {
      if (!rule.variableName || !rule.path) continue;
      // Anti-prototype-pollution : une variable nommée __proto__/constructor/
      // prototype ne doit JAMAIS écrire sur le prototype des objets.
      if (isUnsafeObjectKey(rule.variableName)) continue;
      if (rule.source === "status") {
        ctx.environment[rule.variableName] = String(response.statusCode);
      } else if (rule.source === "header") {
        const headerName = rule.path.toLowerCase();
        const entry = Object.entries(response.headers ?? {}).find(
          ([k]) => k.toLowerCase() === headerName,
        );
        if (entry && entry[1] != null) {
          ctx.environment[rule.variableName] = String(entry[1]);
        }
      } else if (rule.source === "jsonPath") {
        try {
          const bodyObj =
            typeof response.body === "string" ? JSON.parse(response.body) : response.body;
          const val = getJsonPathValue(bodyObj, rule.path);
          if (val !== undefined && val !== null) {
            ctx.environment[rule.variableName] =
              typeof val === "object" ? JSON.stringify(val) : String(val);
          }
        } catch {
          /* ignore parse error */
        }
      }
    }
  }

  // Assertions
  const assertions = (req.runnerAssertions ?? []) as Assertion[];
  result.assertionResults = evaluateAssertions(assertions, response);
  result.status = result.assertionResults.every((r) => r.passed) ? "pass" : "fail";
  return result;
}

function getJsonPathValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const cleanPath = path.replace(/^\$\.?/, "");
  if (!cleanPath) return obj;
  const parts = cleanPath.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (isUnsafeObjectKey(p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function interpolate(value: string, ctx: RunnerContext): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = ctx.environment[k] ?? ctx.iterationData[k];
    // Strip CR/LF so a variable cannot smuggle extra HTTP headers (CRLF).
    return v === undefined ? `{{${k}}}` : String(v).replace(/[\r\n]/g, " ");
  });
}

function headersToRecord(
  headers: Record<string, string> | undefined,
  ctx: RunnerContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    out[key] = interpolate(value, ctx);
  }
  return out;
}

function summarize(results: RequestTestResult[]) {
  const s: { total: number; passed: number; failed: number; skipped: number; errored: number } = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
  };
  for (const r of results) {
    if (r.status === "pass") s.passed++;
    else if (r.status === "fail") s.failed++;
    else if (r.status === "skipped") s.skipped++;
    else if (r.status === "errored") s.errored++;
  }
  return s;
}
