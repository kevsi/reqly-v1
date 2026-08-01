import type { JsonSchema } from "./types";

export type JsonValueType =
  "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

/**
 * Map a JS value to its JSON-Schema primitive type.
 * Integers are detected via Number.isInteger; arrays/null handled explicitly.
 */
export function typeOf(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    default:
      return "null";
  }
}

export interface InferOptions {
  maxDepth?: number;
}

/**
 * Walk a sample value and produce a pragmatic JSON-Schema-ish description.
 * Objects expand into `properties`, arrays into `items` (from the first
 * element), primitives into a `type`. Recursion is capped at `maxDepth`
 * (default 6); beyond that an object/array keeps its type but no children.
 */
export function inferJsonSchema(sample: unknown, opts?: InferOptions): JsonSchema {
  const maxDepth = opts?.maxDepth ?? 6;
  return inferValue(sample, 0, maxDepth);
}

function inferValue(value: unknown, depth: number, maxDepth: number): JsonSchema {
  const type = typeOf(value);

  if (type === "array") {
    const schema: JsonSchema = { type: "array" };
    const arr = value as unknown[];
    if (depth < maxDepth && arr.length > 0) {
      schema.items = inferValue(arr[0], depth + 1, maxDepth);
    }
    return schema;
  }

  if (type === "object") {
    const schema: JsonSchema = { type: "object" };
    if (depth < maxDepth) {
      const obj = value as Record<string, unknown>;
      const properties: Record<string, JsonSchema> = {};
      for (const key of Object.keys(obj)) {
        properties[key] = inferValue(obj[key], depth + 1, maxDepth);
      }
      schema.properties = properties;
    }
    return schema;
  }

  return { type };
}
