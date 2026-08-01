import type { Collection, RequestItem } from "@/lib/types";
import { inferSchemaFromValue } from "@/lib/openapi-inference/infer-schema";
import { mergeInferredWithGeneric } from "@/lib/openapi-inference/merge-schemas";
import { extractExample } from "@/lib/openapi-inference/examples";

export interface OpenApiExportOptions {
  enableInference?: boolean;
  historyItems?: Array<{ requestId: string; responseBody?: unknown }>;
}

function formatPath(request: RequestItem): string {
  const rawPath = request.endpoint?.trim() || request.url?.trim() || "/";
  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    try {
      const url = new URL(rawPath);
      return url.pathname + url.search;
    } catch {
      return rawPath;
    }
  }
  return rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
}

/**
 * Templatize path segments declared as path params, e.g. `/users/{id}`.
 * Matches segments either by their value (stored URL `/users/42` + param
 * `{key: "id", value: "42"}` → `/users/{id}`) or by an already-templated
 * key (`/users/{id}`).
 */
function templatePath(request: RequestItem): string {
  const path = formatPath(request);
  const pathParams = (request.pathParams ?? []).filter((p) => p.enabled !== false && p.key.trim());
  if (pathParams.length === 0) return path;
  const byKey = new Map(pathParams.map((p) => [p.key.trim(), p]));
  const byValue = new Map(pathParams.map((p) => [p.value, p.key.trim()]));
  return path
    .split("/")
    .map((seg) => {
      const raw = seg.trim();
      const keyMatch = /^\{(.+)\}$/.exec(raw);
      if (keyMatch && byKey.has(keyMatch[1])) return `{${keyMatch[1]}}`;
      if (byValue.has(raw)) return `{${byValue.get(raw)}}`;
      return seg;
    })
    .join("/");
}

/**
 * Detect declared path params (used when the stored path is already
 * templated like `/users/{id}` but the params list is empty).
 */
function detectPathParams(request: RequestItem): string[] {
  const declared = (request.pathParams ?? []).map((p) => p.key.trim()).filter(Boolean);
  if (declared.length > 0) return declared;
  const matches = templatePath(request).matchAll(/\{([^}]+)\}/g);
  return [...matches].map((m) => m[1]);
}

function buildSchemaForValue(value?: string) {
  if (!value) return { type: "string" as const };
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed))
      return { type: "array" as const, items: { type: "object" as const } };
    if (typeof parsed === "object" && parsed !== null) return { type: "object" as const };
    if (typeof parsed === "number") return { type: "number" as const };
    if (typeof parsed === "boolean") return { type: "boolean" as const };
  } catch {
    // plain text body
  }
  return { type: "string" as const };
}

function extractHost(request: RequestItem): string | null {
  const raw = request.url?.trim() || request.endpoint?.trim() || "";
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Derive the API `servers` entry from the requests' absolute URLs.
 * Falls back to localhost when no absolute URL is found (e.g. path-only
 * requests like `/users`).
 */
function buildServers(collections: Collection[]): Array<{ url: string; description: string }> {
  const hostCounts = new Map<string, number>();
  for (const collection of collections) {
    for (const request of collection.requests) {
      const host = extractHost(request);
      if (host) hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    }
  }
  if (hostCounts.size === 0) {
    return [{ url: "http://localhost", description: "Local development" }];
  }
  let best = "";
  let bestCount = -1;
  for (const [host, count] of hostCounts) {
    if (count > bestCount) {
      best = host;
      bestCount = count;
    }
  }
  return [{ url: best, description: "API server" }];
}

/**
 * Map a request's auth type to a reusable security scheme name.
 * Requests that reuse the same auth kind share one scheme.
 */
function securitySchemeName(authType: RequestItem["authType"]): string | undefined {
  switch (authType) {
    case "bearer":
      return "bearerAuth";
    case "basic":
      return "basicAuth";
    case "api-key":
      return "apiKeyAuth";
    case "oauth2":
      return "oauth2";
    default:
      return undefined;
  }
}

function operationId(collectionName: string, request: RequestItem): string {
  const slug = `${collectionName}_${request.name}_${request.method}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `operation_${request.method.toLowerCase()}`;
}

function parseResponseBody(body: unknown): unknown | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  return body;
}

function findHistoryResponse(
  historyItems: OpenApiExportOptions["historyItems"],
  requestId: string,
): unknown | undefined {
  if (!historyItems || historyItems.length === 0) return undefined;
  // Pick the most recent matching history item (history is assumed newest-last or newest-first;
  // iterate in reverse to favour the last entry that matches).
  for (let i = historyItems.length - 1; i >= 0; i--) {
    const entry = historyItems[i];
    if (entry.requestId === requestId) {
      const parsed = parseResponseBody(entry.responseBody);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function buildResponseSchema(
  request: RequestItem,
  options?: OpenApiExportOptions,
): Record<string, unknown> {
  const generic = { type: "object" as const };

  if (!options?.enableInference || !options.historyItems) {
    return generic;
  }

  const responseValue = findHistoryResponse(options.historyItems, request.id);
  if (responseValue === undefined) return generic;

  const inferred = inferSchemaFromValue(responseValue);
  const merged = mergeInferredWithGeneric(inferred, generic);
  const example = extractExample(responseValue);

  if (example !== undefined) {
    return { ...merged, example };
  }
  return merged;
}

export function generateOpenApiSpec(collections: Collection[], options?: OpenApiExportOptions) {
  const paths: Record<string, Record<string, unknown>> = {};
  const usedOperationIds = new Set<string>();
  const usedSchemes = new Set<string>();

  collections.forEach((collection) => {
    collection.requests.forEach((request) => {
      const path = templatePath(request);
      const method = request.method.toLowerCase();
      if (!paths[path]) paths[path] = {};

      let opId = operationId(collection.name, request);
      while (usedOperationIds.has(opId)) {
        opId = `${opId}_${usedOperationIds.size}`;
      }
      usedOperationIds.add(opId);

      const parameters = [
        ...detectPathParams(request).map((key) => ({
          name: key,
          in: "path" as const,
          required: true,
          schema: { type: "string" as const },
        })),
        ...(request.queryParams ?? [])
          .filter((param) => param.key.trim())
          .map((param) => ({
            name: param.key.trim(),
            in: "query" as const,
            required: false,
            schema: { type: "string" as const },
            example: param.value.trim() || undefined,
          })),
        ...Object.entries(request.headers ?? {})
          .filter(([key]) => key.trim())
          .map(([key, value]) => ({
            name: key.trim(),
            in: "header" as const,
            required: false,
            schema: { type: "string" as const },
            example: value || undefined,
          })),
      ];

      const requestBody = request.body
        ? {
            required: true,
            content: {
              "application/json": {
                schema: buildSchemaForValue(request.body),
                example: (() => {
                  try {
                    return JSON.parse(request.body);
                  } catch {
                    return request.body;
                  }
                })(),
              },
            },
          }
        : undefined;

      const responseSchema = buildResponseSchema(request, options);

      const schemeName = securitySchemeName(request.authType);
      if (schemeName) usedSchemes.add(schemeName);

      paths[path][method] = {
        operationId: opId,
        tags: [collection.name],
        summary: request.name || `${request.method} ${path}`,
        description: request.url
          ? `Source URL: ${request.url}`
          : `Reqly collection: ${collection.name}`,
        parameters,
        ...(requestBody ? { requestBody } : {}),
        ...(schemeName ? { security: [{ [schemeName]: [] }] } : {}),
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: responseSchema,
              },
            },
          },
          default: {
            description: "Error response",
            content: {
              "application/json": {
                schema: {
                  type: "object" as const,
                  properties: {
                    message: { type: "string" as const },
                  },
                },
              },
            },
          },
        },
      };
    });
  });

  const spec: Record<string, unknown> = {
    openapi: "3.0.3",
    info: {
      title: "Reqly API Collections",
      version: "1.0.0",
      description: "OpenAPI 3.0 export generated from Reqly request collections.",
    },
    servers: buildServers(collections),
    paths,
  };

  if (usedSchemes.size > 0) {
    const schemes: Record<string, unknown> = {};
    for (const name of usedSchemes) {
      if (name === "bearerAuth") {
        schemes[name] = { type: "http", scheme: "bearer", bearerFormat: "JWT" };
      } else if (name === "basicAuth") {
        schemes[name] = { type: "http", scheme: "basic" };
      } else if (name === "apiKeyAuth") {
        schemes[name] = { type: "apiKey", in: "header", name: "X-API-Key" };
      } else if (name === "oauth2") {
        schemes[name] = {
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: "https://example.com/oauth/token",
              scopes: {},
            },
          },
        };
      }
    }
    spec.components = { securitySchemes: schemes };
  }

  return spec;
}
