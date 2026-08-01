import type { CollectionStore } from "../store.js";
import { importFromOpenApi, exportToOpenApi } from "../openapi.js";
import { collectionRunRecordToJUnitXml } from "../junit-export.js";
import { analyzeProjectRoutes } from "../project-analyzer.js";
import { executeGraphQL } from "../runner.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExportBundle, RequestItem } from "../types.js";
import type { ToolHandlerOptions } from "../tool-definitions.js";

// ── Size limits ─────────────────────────────────────────────────────────
const MAX_BUNDLE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_SPEC_SIZE = 5 * 1024 * 1024;    // 5 MB
const MAX_GRAPHQL_QUERY_LENGTH = 500_000; // 500 KB

// ── Sensitive-data redaction ────────────────────────────────────────────

/** Redact sensitive fields from an ExportBundle before returning it. */
function redactSensitiveFields(bundle: ExportBundle): ExportBundle {
  return {
    ...bundle,
    collections: bundle.collections.map((col) => ({
      ...col,
      requests: col.requests.map((req) => ({
        ...req,
        authToken: req.authToken ? "***REDACTED***" : undefined,
        headers: redactSensitiveHeaders(req.headers),
      })),
    })),
  };
}

/** Redact common sensitive header values. */
function redactSensitiveHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const sensitiveKeys = new Set([
    "authorization",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "cookie",
  ]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = sensitiveKeys.has(key.toLowerCase()) && value.length > 0
      ? "***REDACTED***"
      : value;
  }
  return result;
}

// ── Handlers ────────────────────────────────────────────────────────────

export function handleExportBundle(store: CollectionStore, bundle?: ExportBundle): CallToolResult {
  const data = redactSensitiveFields(bundle ?? store.serializeBundle());
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function handleImportBundle(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const bundleJson = String(args.bundle_json ?? "");
  if (!bundleJson) {
    return { content: [{ type: "text", text: "Missing required field: bundle_json" }], isError: true };
  }

  // Size check before parsing — prevents OOM on oversized payloads.
  if (Buffer.byteLength(bundleJson, "utf8") > MAX_BUNDLE_SIZE) {
    return {
      content: [{ type: "text", text: `Bundle JSON exceeds maximum allowed size of ${MAX_BUNDLE_SIZE} bytes` }],
      isError: true,
    };
  }

  try {
    const parsed = JSON.parse(bundleJson) as ExportBundle;
    store.loadFromBundle(parsed);
    return { content: [{ type: "text", text: JSON.stringify({ imported: true }, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Failed to parse bundle JSON: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

export function handleImportFromOpenApi(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const spec = String(args.spec ?? "");
  if (!spec) {
    return { content: [{ type: "text", text: "Missing required field: spec" }], isError: true };
  }

  // Size check before parsing.
  if (Buffer.byteLength(spec, "utf8") > MAX_SPEC_SIZE) {
    return {
      content: [{ type: "text", text: `OpenAPI spec exceeds maximum allowed size of ${MAX_SPEC_SIZE} bytes` }],
      isError: true,
    };
  }

  try {
    const result = importFromOpenApi(spec);
    if (!result.success) {
      return { content: [{ type: "text", text: `Failed to import OpenAPI spec: ${result.error}` }], isError: true };
    }
    let totalRequests = 0;
    for (const col of result.collections) {
      const newCol = store.addCollection(col.name, col.description);
      for (const req of col.requests) {
        const now = Date.now();
        store.addRequest(newCol.id, {
          id: `req-${now}-${Math.random().toString(36).slice(2, 8)}`,
          name: req.name,
          method: req.method as RequestItem["method"],
          url: req.url,
          endpoint: req.endpoint,
          headers: req.headers ?? {},
          body: req.body,
          bodyType: req.bodyType,
          queryParams: req.queryParams,
          createdAt: now,
          updatedAt: now,
        });
        totalRequests++;
      }
    }
    return { content: [{ type: "text", text: JSON.stringify({ imported: true, collections: result.collections.length, requests: totalRequests }, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Failed to import OpenAPI spec: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

export function handleExportToOpenApi(store: CollectionStore): CallToolResult {
  const spec = exportToOpenApi(store.getCollections());
  return { content: [{ type: "text", text: spec }] };
}

export function handleExportCollectionToJUnit(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  if (!colId) {
    return { content: [{ type: "text", text: "Missing required field: collection_id" }], isError: true };
  }
  const records = store.getRunHistory(colId);
  if (!records || records.length === 0) {
    return { content: [{ type: "text", text: `No run records found for collection: ${colId}` }], isError: true };
  }
  const xml = collectionRunRecordToJUnitXml(records[records.length - 1]!);
  return { content: [{ type: "text", text: xml }] };
}

export async function handleAnalyzeProjectRoutes(
  store: CollectionStore,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const folderPath = String(args.folder_path ?? "");
  if (!folderPath) {
    return { content: [{ type: "text", text: "Missing required field: folder_path" }], isError: true };
  }
  try {
    const result = await analyzeProjectRoutes(folderPath, args.allowed_directories as string[] | undefined);
    if (args.save_collection_id) {
      const colId = String(args.save_collection_id);
      for (const route of result.routes) {
        const now = Date.now();
        store.addRequest(colId, {
          id: `req-${now}-${Math.random().toString(36).slice(2, 8)}`,
          name: `${route.method} ${route.path}`,
          method: route.method as RequestItem["method"],
          url: `http://localhost:3000${route.path}`,
          endpoint: `http://localhost:3000${route.path}`,
          headers: {},
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Failed to analyze project: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

export async function handleGraphQlExecute(
  args: Record<string, unknown>,
  options: ToolHandlerOptions,
): Promise<CallToolResult> {
  const url = String(args.url ?? "");
  const query = String(args.query ?? "");
  if (!url || !query) {
    return { content: [{ type: "text", text: "Missing required fields: url, query" }], isError: true };
  }

  // Size check on the GraphQL query to prevent OOM.
  if (Buffer.byteLength(query, "utf8") > MAX_GRAPHQL_QUERY_LENGTH) {
    return {
      content: [{ type: "text", text: `GraphQL query exceeds maximum allowed length of ${MAX_GRAPHQL_QUERY_LENGTH} bytes` }],
      isError: true,
    };
  }

  const variables = args.variables as Record<string, unknown> | undefined;
  const operationName = args.operation_name ? String(args.operation_name) : undefined;
  const headers = args.headers as Record<string, string> | undefined;
  const timeoutMs = typeof args.timeout_ms === "number" && args.timeout_ms > 0 ? args.timeout_ms : options.defaultTimeoutMs;
  try {
    const result = await executeGraphQL(url, query, variables, operationName, headers, {
      timeoutMs,
      allowLocalHosts: options.allowLocalHosts,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `GraphQL execution failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}
