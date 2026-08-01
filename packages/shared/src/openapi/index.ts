/**
 * Module OpenAPI unifié — import/export au format OpenAPI 3.0
 * Basé sur recli (référence la plus avancée) + export depuis reqy-mcp
 */

import yaml from "js-yaml";
import type { ExportBundle, Collection, RequestItem, HttpMethod } from "../types.js";

// ── Interfaces internes ─────────────────────────────────────

interface OAS3Doc {
  openapi: string;
  info?: { title?: string; description?: string; version?: string };
  paths: Record<string, Record<string, OAS3Operation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, OASSecurityScheme>;
  };
  servers?: Array<{ url: string; description?: string }>;
}

interface OAS3Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: "query" | "header" | "path" | "cookie";
    required?: boolean;
    schema?: { type?: string; default?: unknown };
    example?: unknown;
  }>;
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema?: unknown; example?: unknown }>;
  };
  security?: Array<Record<string, string[]>>;
  responses: Record<string, unknown>;
}

interface OASSecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect";
  scheme?: string;
  name?: string;
  in?: string;
  flows?: unknown;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

// ── Import ──────────────────────────────────────────────────

/**
 * Importe une spec OpenAPI (JSON ou YAML) et retourne un ExportBundle.
 * Supporte OpenAPI 3.x
 */
export function importOpenAPI(specYamlOrJson: string): ExportBundle {
  let doc: OAS3Doc;
  try {
    doc = JSON.parse(specYamlOrJson);
  } catch {
    try {
      doc = yaml.load(specYamlOrJson) as OAS3Doc;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to parse OpenAPI spec: ${msg}`);
    }
  }

  if (!doc.openapi || !doc.paths) {
    throw new Error("Invalid OpenAPI spec: missing 'openapi' version or 'paths'");
  }

  const baseUrl = doc.servers?.[0]?.url || "http://localhost";
  const collectionName = doc.info?.title || "OpenAPI Import";
  const requests: RequestItem[] = [];

  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op: OAS3Operation | undefined = (methods as any)[method];
      if (!op) continue;

      const name = op.operationId || op.summary || `${method.toUpperCase()} ${path}`;
      let url = `${baseUrl}${path}`;
      const queryParams: Array<{ key: string; value: string }> = [];
      const headers: Record<string, string> = {};
      let body: string | undefined;

      if (op.parameters) {
        for (const param of op.parameters) {
          if (param.in === "query") {
            queryParams.push({
              key: param.name,
              value:
                param.example !== undefined
                  ? String(param.example)
                  : param.schema?.default !== undefined
                    ? String(param.schema.default)
                    : "",
            });
          } else if (param.in === "header") {
            headers[param.name] = param.example !== undefined ? String(param.example) : "";
          } else if (param.in === "path") {
            url = url.replace(
              `{${param.name}}`,
              param.example !== undefined ? String(param.example) : `:${param.name}`,
            );
          }
        }
      }

      if (op.requestBody) {
        const jsonContent = op.requestBody.content?.["application/json"];
        if (jsonContent?.example) {
          body = JSON.stringify(jsonContent.example, null, 2);
        } else if (jsonContent?.schema) {
          body = JSON.stringify(
            generateExampleFromSchema(jsonContent.schema as Record<string, unknown>),
            null,
            2,
          );
        }
      }

      const httpMethod = method.toUpperCase() as HttpMethod;
      if (
        !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"].includes(
          httpMethod,
        )
      )
        continue;

      requests.push({
        id: `req-${requests.length + 1}`,
        name,
        method: httpMethod,
        url,
        endpoint: path,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        bodyType: body ? "json" : undefined,
        authType: undefined,
        authToken: undefined,
        queryParams: queryParams.length > 0 ? queryParams : undefined,
        sortOrder: requests.length,
      });
    }
  }

  const collection: Collection = {
    id: `col-1`,
    name: collectionName,
    description: `Imported from OpenAPI spec: ${doc.info?.version || "unknown version"}`,
    requests,
  };

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [collection],
  };
}

function generateExampleFromSchema(schema: Record<string, unknown>): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.type === "object" && schema.properties) {
    const result: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
      result[key] = generateExampleFromSchema(prop as Record<string, unknown>);
    }
    return result;
  }
  if (schema.type === "array") {
    const items = schema.items
      ? generateExampleFromSchema(schema.items as Record<string, unknown>)
      : "";
    return [items];
  }
  if (schema.type === "string") {
    if (schema.enum && Array.isArray(schema.enum)) return schema.enum[0];
    if ((schema as any).format === "date-time") return new Date().toISOString();
    if ((schema as any).format === "email") return "user@example.com";
    if ((schema as any).format === "uri") return "https://example.com";
    if ((schema as any).format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
    return "string";
  }
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  return null;
}

// ── Export ──────────────────────────────────────────────────

/**
 * Exporte des collections au format OpenAPI 3.0 (JSON)
 */
export function exportToOpenApi(collections: Collection[]): string {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const collection of collections) {
    for (const request of collection.requests) {
      const rawPath = request.endpoint?.trim() || request.url?.trim() || "/";
      let path = rawPath;
      try {
        const url = new URL(rawPath);
        path = url.pathname;
      } catch {
        if (!path.startsWith("/")) path = `/${path}`;
      }
      const method = request.method.toLowerCase();
      if (!paths[path]) paths[path] = {};

      const parameters = [
        ...(request.queryParams ?? [])
          .filter((p) => p.key.trim())
          .map((p) => ({
            name: p.key.trim(),
            in: "query" as const,
            required: false,
            schema: { type: "string" as const },
            example: p.value.trim() || undefined,
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
                schema: { type: "object" as const },
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

      paths[path][method] = {
        operationId: `${collection.name}_${request.name}_${request.method}`
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, ""),
        tags: [collection.name],
        summary: request.name || `${request.method} ${path}`,
        parameters,
        ...(requestBody ? { requestBody } : {}),
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      };
    }
  }

  const spec = {
    openapi: "3.0.0",
    info: { title: "Exported from Reqly", version: "1.0.0" },
    paths,
  };

  return JSON.stringify(spec, null, 2);
}
