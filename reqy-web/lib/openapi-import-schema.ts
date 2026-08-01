/**
 * OpenAPI schema resolution and example generation utilities.
 * Handles $ref resolution, example extraction from schemas, and
 * generating sample JSON from OpenAPI schema definitions.
 */

// ─── $ref resolution ────────────────────────────────────────────────────────

/** Resolve $ref like "#/components/schemas/LoginDto" against rootSchemas. */
export function resolveRef(
  ref: string,
  rootSchemas: Record<string, unknown>,
): Record<string, unknown> | null {
  const parts = ref.split("/");
  if (parts[0] !== "#" || parts[1] !== "components" || parts[2] !== "schemas") return null;
  const name = parts.slice(3).join("/");
  return (rootSchemas[name] as Record<string, unknown>) ?? null;
}

/** Recursively resolve $ref until we get a concrete schema. */
export function derefSchema(
  schema: Record<string, unknown>,
  rootSchemas: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 10) return schema;
  const ref = schema.$ref as string | undefined;
  if (!ref) return schema;
  const resolved = resolveRef(ref, rootSchemas);
  if (!resolved) return null;
  return derefSchema(resolved, rootSchemas, depth + 1);
}

// ─── Parameter extraction ───────────────────────────────────────────────────

import type { OpenApiParameter, OpenApiRequestBody } from "@/lib/openapi-import-types";

export function extractOperationParams(operation: Record<string, unknown>): OpenApiParameter[] {
  const params = operation.parameters;
  if (!Array.isArray(params)) return [];
  return params
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      name: (p.name as string) || "",
      in: (p.in as "query" | "path" | "header" | "cookie") || "query",
      required: !!p.required,
      description: p.description as string | undefined,
      example: p.example as string | undefined,
    }));
}

export function extractRequestBody(
  operation: Record<string, unknown>,
  rootSchemas: Record<string, unknown> = {},
): OpenApiRequestBody | undefined {
  const rb = operation.requestBody as Record<string, unknown> | undefined;
  if (!rb || typeof rb !== "object") return undefined;

  const content = rb.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object") return undefined;

  // Pick first content type (prefer JSON)
  const contentTypes = Object.keys(content);
  const preferredType = contentTypes.find((t) => t.includes("json")) || contentTypes[0];

  if (!preferredType) return undefined;

  const mediaType = content[preferredType] as Record<string, unknown> | undefined;
  const schema = mediaType?.schema as Record<string, unknown> | undefined;

  return {
    contentType: preferredType,
    required: !!rb.required,
    description: rb.description as string | undefined,
    example: extractExampleFromSchema(schema, mediaType, rootSchemas),
  };
}

// ─── Security extraction ────────────────────────────────────────────────────

export function extractSecurity(
  operation: Record<string, unknown>,
  fallback: Array<Record<string, string[]>> = [],
): Record<string, string[]>[] {
  return (operation.security as Array<Record<string, string[]>>) ?? fallback;
}

// ─── Example generation ─────────────────────────────────────────────────────

export function extractExampleFromSchema(
  schema?: Record<string, unknown>,
  mediaType?: Record<string, unknown>,
  rootSchemas: Record<string, unknown> = {},
): string | undefined {
  // Try direct example on media type
  if (mediaType?.example !== undefined) {
    return tryStringify(mediaType.example);
  }
  if (mediaType?.examples !== undefined) {
    const examples = mediaType.examples as Record<string, unknown>;
    const firstKey = Object.keys(examples)[0];
    if (firstKey && examples[firstKey]) {
      const ex = examples[firstKey] as Record<string, unknown>;
      if (ex.value !== undefined) return tryStringify(ex.value);
    }
  }

  if (!schema) return undefined;

  // Try schema-level example
  if (schema.example !== undefined) return tryStringify(schema.example);
  if (schema.default !== undefined) return tryStringify(schema.default);

  // Generate example from schema type (with $ref resolution)
  return generateExampleFromSchema(schema, rootSchemas);
}

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function defaultValueForFormat(format: string | undefined, type: string): unknown {
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

/** Generate a sample JSON value from an OpenAPI schema, resolving $refs. */
function generateExampleFromSchema(
  rawSchema: Record<string, unknown>,
  rootSchemas: Record<string, unknown> = {},
  depth = 0,
): string | undefined {
  if (depth > 10) return undefined;

  // Resolve $ref before processing
  const schema = derefSchema(rawSchema, rootSchemas);
  if (!schema) return undefined;

  // Check example/default directly
  if (schema.example !== undefined) return tryStringify(schema.example);
  if (schema.default !== undefined) return tryStringify(schema.default);

  // Handle enum
  const enumVals = schema.enum as unknown[] | undefined;
  if (Array.isArray(enumVals) && enumVals.length > 0) return tryStringify(enumVals[0]);

  // Handle composition (allOf)
  const allOf = schema.allOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(allOf) && allOf.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const sub of allOf) {
      const subResult = generateExampleFromSchema(sub, rootSchemas, depth + 1);
      if (subResult) {
        try {
          const parsed = JSON.parse(subResult);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            Object.assign(merged, parsed);
          }
        } catch {
          // skip string results
        }
      }
    }
    if (Object.keys(merged).length > 0) return JSON.stringify(merged, null, 2);
  }

  // Handle anyOf/oneOf — pick first branch that yields a result
  const anyOf = schema.anyOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    for (const branch of anyOf) {
      const result = generateExampleFromSchema(branch, rootSchemas, depth + 1);
      if (result) return result;
    }
  }
  const oneOf = schema.oneOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    for (const branch of oneOf) {
      const result = generateExampleFromSchema(branch, rootSchemas, depth + 1);
      if (result) return result;
    }
  }

  // Generate by type
  const type = schema.type as string | undefined;
  const format = schema.format as string | undefined;

  if (type === "object" || schema.properties) {
    const props = schema.properties as Record<string, unknown> | undefined;
    if (!props) return JSON.stringify({}, null, 2);
    const example: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      const propSchema = val as Record<string, unknown>;
      // Resolve $ref for the property
      const resolvedProp = derefSchema(propSchema, rootSchemas);
      if (!resolvedProp) {
        example[key] = null;
        continue;
      }

      const propExample = resolvedProp.example ?? resolvedProp.default;
      if (propExample !== undefined) {
        example[key] = propExample;
        continue;
      }

      // Handle enum in property
      const propEnum = resolvedProp.enum as unknown[] | undefined;
      if (Array.isArray(propEnum) && propEnum.length > 0) {
        example[key] = propEnum[0];
        continue;
      }

      const propType = resolvedProp.type as string | undefined;
      const propFormat = resolvedProp.format as string | undefined;

      // Handle nested object via recursion
      if (propType === "object" || resolvedProp.properties) {
        const nested = generateExampleFromSchema(resolvedProp, rootSchemas, depth + 1);
        try {
          example[key] = nested ? JSON.parse(nested) : null;
        } catch {
          example[key] = null;
        }
        continue;
      }

      // Handle array items
      if (propType === "array") {
        const items = resolvedProp.items as Record<string, unknown> | undefined;
        if (items) {
          const resolvedItems = derefSchema(items, rootSchemas);
          if (resolvedItems) {
            const itemExample = generateExampleFromSchema(resolvedItems, rootSchemas, depth + 1);
            try {
              example[key] = itemExample ? [JSON.parse(itemExample)] : [];
            } catch {
              example[key] = [];
            }
          } else {
            example[key] = [];
          }
        } else {
          example[key] = [];
        }
        continue;
      }

      // Primitive with format
      if (propFormat && propType === "string") {
        example[key] = defaultValueForFormat(propFormat, "string");
        continue;
      }

      // Simple type-based default
      example[key] = defaultValueForFormat(undefined, propType ?? "string");
    }
    return JSON.stringify(example, null, 2);
  }

  if (type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      const resolvedItems = derefSchema(items, rootSchemas);
      if (resolvedItems) {
        const itemExample = generateExampleFromSchema(resolvedItems, rootSchemas, depth + 1);
        if (itemExample) {
          try {
            return JSON.stringify([JSON.parse(itemExample)], null, 2);
          } catch {
            return "[]";
          }
        }
      }
    }
    return "[]";
  }

  // Primitive type
  if (type === "string" && format) {
    return tryStringify(defaultValueForFormat(format, "string"));
  }

  return undefined;
}

function tryStringify(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
