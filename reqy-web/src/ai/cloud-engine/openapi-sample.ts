/**
 * Phase 6.3 — Generate a sample JSON body from an OpenAPI / JSON Schema
 *
 * Pure function. Recursively walks the schema and produces a value that
 * satisfies the structure: handles primitives (with example/default/enum),
 * objects (required + optional), arrays, $ref, and composition keywords.
 */

export interface OpenAPISchema {
  type?: string | string[];
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  items?: OpenAPISchema;
  $ref?: string;
  allOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  nullable?: boolean;
  description?: string;
  /** Minimum / maximum for numbers. */
  minimum?: number;
  maximum?: number;
  /** Minimum / maximum length for strings. */
  minLength?: number;
  maxLength?: number;
  /** For arrays. */
  minItems?: number;
  maxItems?: number;
}

export interface GenerateOptions {
  /** Lookup for $ref resolution (key: schema name, value: schema). */
  rootSchemas?: Record<string, OpenAPISchema>;
  /** Max recursion depth (safety against circular refs). */
  maxDepth?: number;
  /** Whether to include optional (non-required) properties. */
  includeOptionals?: boolean;
}

import { uuidV4 } from "@/lib/utils";

/**
 * Generate an example value for an OpenAPI schema.
 * @param schema The schema to generate an example from
 */

function defaultForFormat(format: string | undefined, type: string): unknown {
  if (!format) {
    switch (type) {
      case "string":
        return "string";
      case "integer":
        return 0;
      case "number":
        return 0.0;
      case "boolean":
        return false;
      default:
        return null;
    }
  }
  switch (format) {
    case "email":
      return "user@example.com";
    case "uuid":
      return uuidV4();
    case "uri":
    case "url":
      return "https://example.com";
    case "date":
      return "2025-01-01";
    case "date-time":
      return "2025-01-01T00:00:00Z";
    case "time":
      return "12:00:00";
    case "ipv4":
      return "127.0.0.1";
    case "ipv6":
      return "::1";
    case "hostname":
      return "example.com";
    case "byte":
      return "aGVsbG8=";
    case "binary":
      return "";
    default:
      switch (type) {
        case "integer":
          return 0;
        case "number":
          return 0.0;
        case "boolean":
          return false;
        default:
          return "string";
      }
  }
}

/** Pick the first non-null branch — used for oneOf/anyOf. */
function pickBranch(branches: OpenAPISchema[], depth: number, opts: GenerateOptions): unknown {
  for (const b of branches) {
    const v = generateFromSchema(b, depth + 1, opts);
    if (v !== undefined) return v;
  }
  return null;
}

/** Resolve $ref like "#/components/schemas/User" against rootSchemas. */
function resolveRef(ref: string, root: Record<string, OpenAPISchema> = {}): OpenAPISchema | null {
  const parts = ref.split("/");
  if (parts[0] !== "#" || parts[1] !== "components" || parts[2] !== "schemas") return null;
  const name = parts.slice(3).join("/");
  return root[name] ?? null;
}

/**
 * Recursively generate a value matching the given schema.
 */
export function generateFromSchema(
  schema: OpenAPISchema,
  depth = 0,
  options: GenerateOptions = {},
): unknown {
  const maxDepth = options.maxDepth ?? 10;
  if (depth > maxDepth) return null;

  const root = options.rootSchemas ?? {};

  // 1. example/default short-circuits
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  // 2. enum: pick the first value
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  // 3. $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved) return generateFromSchema(resolved, depth + 1, options);
    return null;
  }

  // 4. composition
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const sub of schema.allOf) {
      const v = generateFromSchema(sub, depth + 1, options);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(merged, v as Record<string, unknown>);
      }
    }
    return merged;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return pickBranch(schema.anyOf, depth, options);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return pickBranch(schema.oneOf, depth, options);
  }

  // 5. by type
  const type = Array.isArray(schema.type)
    ? schema.type.filter((t) => t !== "null")[0]
    : schema.type;
  switch (type) {
    case "object": {
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const includeOptionals = options.includeOptionals !== false;
      const out: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(props)) {
        if (required.has(name) || includeOptionals) {
          out[name] = generateFromSchema(sub, depth + 1, options);
        }
      }
      return out;
    }
    case "array": {
      const items = schema.items ?? { type: "string" };
      const count = Math.max(1, schema.minItems ?? 1);
      const max = Math.min(count, schema.maxItems ?? 3);
      return Array.from({ length: max }, () => generateFromSchema(items, depth + 1, options));
    }
    case "string":
    case "integer":
    case "number":
    case "boolean":
      return defaultForFormat(schema.format, type);
    default:
      return null;
  }
}

/**
 * Convenience wrapper: generate from the requestBody schema of an
 * OpenAPI operation, given a full OpenAPI spec.
 */
export function generateBodyFromOpenApiRequest(
  requestBodySchema: OpenAPISchema,
  openApiSpec: { components?: { schemas?: Record<string, OpenAPISchema> } },
): unknown {
  return generateFromSchema(requestBodySchema, 0, {
    rootSchemas: openApiSpec.components?.schemas ?? {},
  });
}
