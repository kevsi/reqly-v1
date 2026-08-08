import yaml from "js-yaml";
import type { ExportBundle, RequestItem, Collection, HttpMethod } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────

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
    schema?: { type?: string; default?: unknown; $ref?: string };
    example?: unknown;
  }>;
  requestBody?: {
    required?: boolean;
    content: Record<
      string,
      { schema?: unknown; example?: unknown; examples?: Record<string, { value?: unknown }> }
    >;
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

/** Result type used by the MCP `import_from_openapi` tool. */
export type OpenApiImportResult =
  | {
      success: true;
      title: string;
      version: string;
      baseUrl?: string;
      collections: OpenApiImportedCollection[];
    }
  | { success: false; error: string };

export interface OpenApiImportedCollection {
  name: string;
  description?: string;
  requests: OpenApiImportRequest[];
}

export interface OpenApiImportRequest {
  name: string;
  method: string;
  url: string;
  endpoint?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyType?: RequestItem["bodyType"];
  queryParams?: Array<{ key: string; value: string }>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

// ── Shared helpers ───────────────────────────────────────────────────────

function resolveRefExample(
  schema: Record<string, unknown> | undefined,
  schemas?: Record<string, unknown>,
): unknown {
  if (!schema || typeof schema !== "object") return undefined;
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/components/schemas/")) return undefined;
  const name = ref.replace("#/components/schemas/", "");
  const def = schemas?.[name] as Record<string, unknown> | undefined;
  return def?.example;
}

function extractBodyFromMedia(
  content: Record<
    string,
    { schema?: unknown; example?: unknown; examples?: Record<string, { value?: unknown }> }
  >,
  schemas?: Record<string, unknown>,
): { body?: string; contentType?: string } {
  for (const [ct, media] of Object.entries(content)) {
    // Direct example (3.0)
    if (media.example !== undefined)
      return { body: JSON.stringify(media.example), contentType: ct };
    // Named examples map (3.1)
    if (media.examples) {
      const first = Object.values(media.examples)[0];
      if (first?.value !== undefined) return { body: JSON.stringify(first.value), contentType: ct };
    }
    // Schema-level example (3.0)
    const schema = media.schema as Record<string, unknown> | undefined;
    if (schema?.example !== undefined)
      return { body: JSON.stringify(schema.example), contentType: ct };
    // $ref into components → resolve one level (3.0/3.1)
    const refExample = resolveRefExample(schema, schemas);
    if (refExample !== undefined) return { body: JSON.stringify(refExample), contentType: ct };
    // Fallback: generate from schema structure
    if (schema)
      return { body: JSON.stringify(generateExampleFromSchema(schema), null, 2), contentType: ct };
  }
  return {};
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

// ── CLI importer (returns recli ExportBundle) ────────────────────────────

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

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Invalid OpenAPI spec: not an object");
  }
  if (!doc.openapi || !doc.paths) {
    throw new Error("Invalid OpenAPI spec: missing 'openapi' version or 'paths'");
  }

  const baseUrl = doc.servers?.[0]?.url || "http://localhost";
  const collectionName = doc.info?.title || "OpenAPI Import";
  const schemas = doc.components?.schemas;
  const requests: RequestItem[] = [];

  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op: OAS3Operation | undefined = (methods as any)[method];
      if (!op) continue;

      const name = op.operationId || op.summary || `${method.toUpperCase()} ${path}`;
      let url = `${baseUrl}${path}`;
      const queryParams: Array<{ key: string; value: string }> = [];
      const headers: Record<string, string> = {};

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

      let body: string | undefined;
      if (op.requestBody?.content) {
        const result = extractBodyFromMedia(op.requestBody.content, schemas);
        body = result.body;
      }

      const httpMethod = method.toUpperCase() as HttpMethod;
      if (
        !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"].includes(
          httpMethod,
        )
      )
        continue;

      requests.push({
        name,
        method: httpMethod,
        url,
        endpoint: path,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        bodyType: body ? "json" : undefined,
        queryParams: queryParams.length > 0 ? queryParams : undefined,
        description: op.summary || op.description,
      });
    }
  }

  const collection: Collection = {
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

// ── MCP importer (result type for the import_from_openapi tool) ──────────

export function importFromOpenApi(contents: string): OpenApiImportResult {
  try {
    // Parse spec once to extract baseUrl directly.
    let spec: Record<string, unknown> | undefined;
    try {
      spec = JSON.parse(contents) as Record<string, unknown>;
    } catch {
      /* yaml handled by importOpenAPI */
    }
    const baseUrl = (() => {
      try {
        const servers = spec?.servers as Array<Record<string, unknown>> | undefined;
        if (servers?.[0]?.url) return String(servers[0].url);
      } catch {
        /* ignore */
      }
      return undefined;
    })();

    const bundle = importOpenAPI(contents);
    const col = bundle.collections[0];
    return {
      success: true,
      title: col?.name ?? "API",
      version: "1.0",
      baseUrl,
      collections: col
        ? [
            {
              name: col.name,
              description: col.description,
              requests: (col.requests ?? []).map((r) => ({
                name: r.name,
                method: r.method,
                url: r.url,
                endpoint: r.endpoint,
                headers: r.headers,
                body: r.body,
                bodyType: r.bodyType,
                queryParams: r.queryParams,
              })),
            },
          ]
        : [],
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── OpenAPI exporter (3.1) ──────────────────────────────────────────────

export function exportToOpenApi(
  collections: Array<{
    name: string;
    requests: Array<{
      method: string;
      endpoint?: string;
      url: string;
      name: string;
      headers?: Record<string, string>;
      body?: string;
      queryParams?: Array<{ key: string; value: string }>;
    }>;
  }>,
): string {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const collection of collections) {
    for (const request of collection.requests) {
      const rawPath = request.endpoint?.trim() || request.url?.trim() || "/";
      let reqPath = rawPath;
      try {
        const url = new URL(rawPath);
        reqPath = url.pathname;
      } catch {
        if (!reqPath.startsWith("/")) reqPath = `/${reqPath}`;
      }
      const method = request.method.toLowerCase();
      if (!paths[reqPath]) paths[reqPath] = {};

      const parameters = [
        ...(request.queryParams ?? [])
          .filter((p) => p.key.trim())
          .map((p) => ({
            name: p.key.trim(),
            in: "query",
            required: false,
            schema: { type: "string" },
            example: p.value.trim() || undefined,
          })),
        ...Object.entries(request.headers ?? {})
          .filter(([key]) => key.trim())
          .map(([key, value]) => ({
            name: key.trim(),
            in: "header",
            required: false,
            schema: { type: "string" },
            example: value || undefined,
          })),
      ];

      const requestBody = request.body
        ? {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object" },
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

      paths[reqPath][method] = {
        operationId: `${collection.name}_${request.name}_${request.method}`
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, ""),
        tags: [collection.name],
        summary: request.name || `${request.method} ${reqPath}`,
        parameters,
        ...(requestBody ? { requestBody } : {}),
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
        },
      };
    }
  }

  const spec = {
    openapi: "3.1.0",
    info: { title: "Exported from Reqly", version: "1.0.0" },
    paths,
  };

  return JSON.stringify(spec, null, 2);
}
