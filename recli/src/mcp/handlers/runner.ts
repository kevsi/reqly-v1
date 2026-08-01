import type { CollectionStore } from "../store.js";
import { executeRequestWithAssertions } from "../runner.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExportBundle, RequestRunRecord, CollectionRunRecord } from "../types.js";
import type { ToolHandlerOptions } from "../tool-definitions.js";

function resolveRunOptions(
  args: Record<string, unknown>,
  defaultTimeoutMs: number,
  defaultEnvName?: string,
): { timeoutMs: number; envName?: string } {
  const timeoutMs = typeof args.timeout_ms === "number" && args.timeout_ms > 0 ? args.timeout_ms : defaultTimeoutMs;
  const envName = args.env_name ? String(args.env_name) : defaultEnvName;
  return { timeoutMs, envName };
}

export async function handleRunRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
  bundle: ExportBundle | undefined,
  options: ToolHandlerOptions,
): Promise<CallToolResult> {
  const runRequestId = String(args.request_id ?? "");
  const { timeoutMs, envName } = resolveRunOptions(args, options.defaultTimeoutMs, options.defaultEnvName);
  const foundRun = store.findRequestById(runRequestId);
  if (!foundRun) {
    return { content: [{ type: "text", text: `Request not found: ${runRequestId}` }], isError: true };
  }
  const result = await executeRequestWithAssertions(
    foundRun.request,
    { timeoutMs, envName, allowLocalHosts: options.allowLocalHosts, maxResponseSize: options.maxResponseSize },
    bundle?.environments,
  );
  const singleRunId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const singleRunRecord: RequestRunRecord = {
    id: singleRunId,
    requestId: foundRun.request.id,
    requestName: foundRun.request.name,
    collectionId: foundRun.collection.id,
    collectionName: foundRun.collection.name,
    method: result.method,
    url: result.url,
    status: result.status,
    statusText: result.statusText,
    durationMs: result.durationMs,
    size: result.size,
    passed: result.passed,
    assertionResults: result.assertionResults,
    error: result.error,
    body: result.body,
    executedAt: Date.now(),
  };
  store.addRunRecord({
    id: singleRunId,
    collectionId: foundRun.collection.id,
    collectionName: foundRun.collection.name,
    startedAt: Date.now(),
    completedAt: Date.now(),
    totalDurationMs: result.durationMs,
    results: [singleRunRecord],
    summary: { total: 1, passed: result.passed ? 1 : 0, failed: !result.passed && !result.error ? 1 : 0, errored: result.error ? 1 : 0 },
  });
  const output = {
    name: result.name,
    method: result.method,
    url: result.url,
    status: result.status,
    status_text: result.statusText,
    duration_ms: result.durationMs,
    size_bytes: result.size,
    passed: result.passed,
    assertions_passed: result.assertionsPassed ?? null,
    assertion_results: result.assertionResults ?? null,
    error: result.error ?? null,
    body: result.body ?? null,
  };
  return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
}

export async function handleRunCollection(
  store: CollectionStore,
  args: Record<string, unknown>,
  bundle: ExportBundle | undefined,
  options: ToolHandlerOptions,
): Promise<CallToolResult> {
  const colId = String(args.collection_id ?? "");
  const { timeoutMs, envName } = resolveRunOptions(args, options.defaultTimeoutMs, options.defaultEnvName);
  const collection = store.getCollection(colId);
  if (!collection) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  const results = [];
  for (const req of collection.requests) {
    const result = await executeRequestWithAssertions(
      req,
      { timeoutMs, envName, allowLocalHosts: options.allowLocalHosts, maxResponseSize: options.maxResponseSize },
      bundle?.environments,
    );
    results.push(result);
  }
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runRecords: RequestRunRecord[] = results.map((r, i) => ({
    id: `${runId}-${i}`,
    requestId: collection.requests[i]!.id,
    requestName: collection.requests[i]!.name,
    collectionId: colId,
    collectionName: collection.name,
    method: r.method,
    url: r.url,
    status: r.status,
    statusText: r.statusText,
    durationMs: r.durationMs,
    size: r.size,
    passed: r.passed,
    assertionResults: r.assertionResults,
    error: r.error,
    body: r.body,
    executedAt: Date.now(),
  }));
  const summary = { total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed && !r.error).length, errored: results.filter((r) => r.error).length };
  store.addRunRecord({
    id: runId,
    collectionId: colId,
    collectionName: collection.name,
    startedAt: Date.now(),
    completedAt: Date.now(),
    totalDurationMs: results.reduce((a, r) => a + (r.durationMs ?? 0), 0),
    results: runRecords,
    summary,
  });
  return { content: [{ type: "text", text: JSON.stringify({ collection_name: collection.name, ...summary, results: results.map((r) => ({ name: r.name, method: r.method, url: r.url, status: r.status, duration_ms: r.durationMs, passed: r.passed, error: r.error ?? null })) }, null, 2) }] };
}

export async function handleRunRequestsBatch(
  store: CollectionStore,
  args: Record<string, unknown>,
  bundle: ExportBundle | undefined,
  options: ToolHandlerOptions,
): Promise<CallToolResult> {
  const requestIds = args.request_ids as string[] | undefined;
  const { timeoutMs, envName } = resolveRunOptions(args, options.defaultTimeoutMs, options.defaultEnvName);
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return { content: [{ type: "text", text: "Missing required field: request_ids" }], isError: true };
  }
  const batch = requestIds.slice(0, options.maxBatchSize ?? 20);
  const results = [];
  for (const reqId of batch) {
    const found = store.findRequestById(reqId);
    if (!found) {
      results.push({ request_id: reqId, error: "Request not found" });
      continue;
    }
    const result = await executeRequestWithAssertions(
      found.request,
      { timeoutMs, envName, allowLocalHosts: options.allowLocalHosts, maxResponseSize: options.maxResponseSize },
      bundle?.environments,
    );
    results.push({ request_id: reqId, name: result.name, method: result.method, url: result.url, status: result.status, duration_ms: result.durationMs, passed: result.passed, error: result.error ?? null });
  }
  return { content: [{ type: "text", text: JSON.stringify({ batch_size: batch.length, results }, null, 2) }] };
}

export async function handleRunCollectionWithAssertions(
  store: CollectionStore,
  args: Record<string, unknown>,
  bundle: ExportBundle | undefined,
  options: ToolHandlerOptions,
): Promise<CallToolResult> {
  const colId = String(args.collection_id ?? "");
  const { timeoutMs, envName } = resolveRunOptions(args, options.defaultTimeoutMs, options.defaultEnvName);
  const collection = store.getCollection(colId);
  if (!collection) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  const runResults = [];
  for (const req of collection.requests) {
    const result = await executeRequestWithAssertions(
      req,
      { timeoutMs, envName, allowLocalHosts: options.allowLocalHosts, maxResponseSize: options.maxResponseSize },
      bundle?.environments,
    );
    runResults.push(result);
  }
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const summary = { total: runResults.length, passed: runResults.filter((r) => r.passed).length, failed: runResults.filter((r) => !r.passed && !r.error).length, errored: runResults.filter((r) => r.error).length };
  return { content: [{ type: "text", text: JSON.stringify({ run_id: runId, collection_name: collection.name, summary, results: runResults.map((r) => ({ name: r.name, method: r.method, url: r.url, status: r.status, duration_ms: r.durationMs, passed: r.passed, assertion_results: r.assertionResults ?? [], error: r.error ?? null })) }, null, 2) }] };
}

export function handleGetRequestHistory(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const reqId = String(args.request_id ?? "");
  const limit = typeof args.limit === "number" ? args.limit : 10;
  if (!reqId) {
    return { content: [{ type: "text", text: "Missing required field: request_id" }], isError: true };
  }
  const records = store.getRequestHistory(reqId)?.slice(0, limit) ?? [];
  return { content: [{ type: "text", text: JSON.stringify(records, null, 2) }] };
}

export function handleGetRunHistory(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = args.collection_id ? String(args.collection_id) : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const records = store.getRunHistory(colId)?.slice(0, limit) ?? [];
  const output = records.map((r: CollectionRunRecord) => ({
    id: r.id,
    collection_id: r.collectionId,
    collection_name: r.collectionName,
    started_at: r.startedAt,
    total: r.summary.total,
    passed: r.summary.passed,
    failed: r.summary.failed,
    errored: r.summary.errored,
  }));
  return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
}
