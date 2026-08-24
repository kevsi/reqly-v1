/**
 * Contract testing — validate API responses against an OpenAPI 3 spec.
 *
 * Given a parsed OAS3 document and a set of RunResults, find the response
 * schema for each (path, method, status) and validate the response body
 * against it using the shared JSON Schema validator. `$ref` pointers to
 * `components/schemas` are inlined first, since the shared validator does not
 * resolve references itself.
 */
import yaml from "js-yaml";
import { evaluateSchemaAssertion } from "@reqly/shared/assertions";
import type { RunResult, AssertionResult, HttpMethod } from "./types.js";

export interface OAS3Response {
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

export interface OAS3Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: "query" | "header" | "path" | "cookie";
    required?: boolean;
    schema?: { type?: string; enum?: unknown[]; default?: unknown; format?: string };
    example?: unknown;
  }>;
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema?: Record<string, unknown>; example?: unknown }>;
  };
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, OAS3Response>;
}

export interface OAS3Doc {
  openapi?: string;
  info?: { title?: string; description?: string; version?: string };
  paths?: Record<string, Record<string, OAS3Operation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, { type: string; scheme?: string; name?: string; in?: string }>;
  };
  servers?: Array<{ url: string }>;
}

/** Parse an OpenAPI spec from JSON or YAML (strips BOM if present). */
export function parseSpec(content: string): OAS3Doc {
  const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  try {
    return JSON.parse(clean) as OAS3Doc;
  } catch {
    return yaml.load(clean) as OAS3Doc;
  }
}

/** Resolve a JSON pointer like "#/components/schemas/Pet" against the doc root. */
function resolveRef(ref: string, root: OAS3Doc): Record<string, unknown> | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const seg of ref.slice(2).split("/")) {
    if (node == null || typeof node !== "object") return undefined;
    // Anti-prototype-pollution : ne jamais suivre __proto__/constructor/prototype
    if (seg === "__proto__" || seg === "constructor" || seg === "prototype") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node && typeof node === "object" ? (node as Record<string, unknown>) : undefined;
}

/**
 * Deep-clone a schema, replacing every `{$ref: "..."}` with the resolved
 * sub-schema. Cycles are guarded by a `seen` set: a re-encountered ref is
 * replaced with an empty object (the validator treats that as `any`).
 */
function inlineRefs(schema: unknown, root: OAS3Doc, seen: Set<string> = new Set()): unknown {
  if (schema == null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((item) => inlineRefs(item, root, seen));
  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    if (seen.has(obj.$ref)) return {};
    const resolved = resolveRef(obj.$ref, root);
    if (!resolved) return {};
    return inlineRefs(resolved, root, new Set([...seen, obj.$ref]));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // ponytail: the shared JSON Schema validator maps typeof → type string, so
    // "integer" (valid OpenAPI) never matches (typeof 42 === "number"). Collapse
    // to "number" during inlining — we don't validate fractional parts anyway.
    // Ceiling: a spec relying on integer-only validation (rejecting 3.14) won't
    // be enforced here; upgrade path: teach the shared validator about integer.
    if (k === "type" && v === "integer") {
      out[k] = "number";
    } else {
      out[k] = inlineRefs(v, root, seen);
    }
  }
  return out;
}

/** Convert a path template "/users/{id}" into a RegExp matching concrete paths. */
function pathTemplateToRegex(template: string): RegExp {
  // { and } are not regex metachars, so they survive escaping as literals,
  // then we replace {param} placeholders with [^/]+.
  const escaped = template.replace(/[\\^$.*+?()|[\]]/g, "\\$&");
  const pattern = escaped.replace(/\{[^}]+\}/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

/** Find the response schema for (path, method, status) in the spec. */
function findResponseSchema(
  doc: OAS3Doc,
  requestPath: string,
  method: string,
  status: number,
): Record<string, unknown> | undefined {
  const lowerMethod = method.toLowerCase();
  const paths = doc.paths;
  if (!paths) return undefined;

  // 1. exact path match, 2. template match
  let op = paths[requestPath]?.[lowerMethod];
  if (!op) {
    for (const [tmpl, methods] of Object.entries(paths)) {
      if (pathTemplateToRegex(tmpl).test(requestPath)) {
        op = methods?.[lowerMethod];
        if (op) break;
      }
    }
  }
  if (!op?.responses) return undefined;

  // status exact, then class wildcard (2XX/4XX…), then default
  const responses = op.responses;
  const statusStr = String(status);
  let resp = responses[statusStr] ?? responses.default;
  if (!resp) {
    const cls = `${Math.floor(status / 100)}XX`;
    resp = responses[cls] ?? responses.default;
  }
  if (!resp?.content) return undefined;

  // prefer application/json, else first content type carrying a schema
  const json = resp.content["application/json"];
  if (json?.schema) return json.schema as Record<string, unknown>;
  for (const ct of Object.values(resp.content)) {
    if (ct?.schema) return ct.schema as Record<string, unknown>;
  }
  return undefined;
}
/** Extract the URL path, relative to the spec's base URL when possible. */
function extractPath(url: string, baseUrl: string): string {
  try {
    const u = new URL(url);
    if (baseUrl) {
      try {
        const b = new URL(baseUrl);
        if (u.origin === b.origin) {
          const basePath = b.pathname.replace(/\/$/, "");
          if (basePath && u.pathname.startsWith(basePath)) {
            return u.pathname.slice(basePath.length) || "/";
          }
        }
      } catch {
        /* ignore malformed base */
      }
    }
    return u.pathname;
  } catch {
    return url;
  }
}

export interface ContractCheck {
  result: RunResult;
  path: string;
  method: HttpMethod;
  status: number;
  /** A response schema was found in the spec for this (path, method, status). */
  schemaFound: boolean;
  /** The schema validation result (absent when no schema or no HTTP response). */
  assertion?: AssertionResult;
}

/**
 * Validate each RunResult's body against the response schema declared in the
 * spec. Requests that did not reach an HTTP response (status 0) are skipped.
 * Requests with no matching schema in the spec are reported as `schemaFound:
 * false` but do not fail — undocumented routes are a warning, not a violation.
 */
export function checkContract(results: RunResult[], doc: OAS3Doc): ContractCheck[] {
  const base = doc.servers?.[0]?.url ?? "";
  return results.map((result) => {
    const requestPath = extractPath(result.url, base);
    const method: HttpMethod = result.method;
    const httpMethod = method === "GRAPHQL" ? "post" : method.toLowerCase();

    // No HTTP response (network error / timeout) — nothing to validate.
    if (result.status === 0) {
      return { result, path: requestPath, method, status: result.status, schemaFound: false };
    }

    const schema = findResponseSchema(doc, requestPath, httpMethod, result.status);
    if (!schema) {
      return { result, path: requestPath, method, status: result.status, schemaFound: false };
    }

    const inlined = inlineRefs(schema, doc) as Record<string, unknown>;
    const assertion = evaluateSchemaAssertion(inlined, result.body) as unknown as AssertionResult;
    return {
      result,
      path: requestPath,
      method,
      status: result.status,
      schemaFound: true,
      assertion,
    };
  });
}
