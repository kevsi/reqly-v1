/**
 * JSON Schema validation (subset, sufficient for assertion use cases).
 *
 * Supports: type, properties, items, required, enum, minimum/maximum,
 * minLength/maxLength, pattern, nullable, oneOf/anyOf/allOf.
 * `$ref` is rejected (cannot be resolved without a root document).
 */

export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  nullable?: boolean;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ReDoS-safe pattern test: limits pattern length and wraps RegExp creation
 * in a try/catch so a malformed pattern cannot crash the runner.
 */
function testPattern(pattern: string, value: string): boolean {
  if (pattern.length > 200) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function getActualType(data: unknown): string {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  return typeof data;
}

/**
 * Validate a JSON document against a (subset of) JSON Schema.
 * Returns a list of human-readable error messages.
 */
export function validateSchema(
  raw: JSONSchema | Record<string, unknown>,
  data: unknown,
  path = "$",
): string[] {
  const errors: string[] = [];
  const s = raw as JSONSchema;

  // $ref cannot be resolved without a root document — fail closed rather
  // than silently accepting every value (a false "pass" for an assertion).
  if (s.$ref) {
    errors.push(
      `${path}: unsupported keyword "$ref" (${s.$ref}) — resolve the reference before asserting`,
    );
    return errors;
  }

  if (s.nullable && (data === null || data === undefined)) return errors;
  if (data === null || data === undefined) {
    errors.push(`${path}: expected non-null, got ${data}`);
    return errors;
  }

  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const actualType = getActualType(data);
    if (!types.includes(actualType)) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${actualType}`);
      return errors;
    }
  }

  if (s.enum && Array.isArray(s.enum) && !s.enum.includes(data)) {
    errors.push(`${path}: expected one of [${s.enum.join(", ")}], got ${String(data)}`);
  }

  if (typeof data === "number") {
    if (typeof s.minimum === "number" && data < s.minimum) {
      errors.push(`${path}: expected >= ${s.minimum}, got ${data}`);
    }
    if (typeof s.maximum === "number" && data > s.maximum) {
      errors.push(`${path}: expected <= ${s.maximum}, got ${data}`);
    }
  }

  if (typeof data === "string") {
    if (typeof s.minLength === "number" && data.length < s.minLength) {
      errors.push(`${path}: expected minLength ${s.minLength}, got ${data.length}`);
    }
    if (typeof s.maxLength === "number" && data.length > s.maxLength) {
      errors.push(`${path}: expected maxLength ${s.maxLength}, got ${data.length}`);
    }
    if (typeof s.pattern === "string" && !testPattern(s.pattern, data)) {
      errors.push(`${path}: expected pattern ${s.pattern}, got "${data}"`);
    }
  }

  if (Array.isArray(s.required) && typeof data === "object" && !Array.isArray(data)) {
    for (const key of s.required) {
      if (typeof key === "string" && !(key in (data as Record<string, unknown>))) {
        errors.push(`${path}: missing required field "${key}"`);
      }
    }
  }

  if (s.properties && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, propSchema] of Object.entries(s.properties)) {
      if (key in (data as Record<string, unknown>)) {
        const value = (data as Record<string, unknown>)[key];
        errors.push(...validateSchema(propSchema, value, `${path}.${key}`));
      }
    }
  }

  if (s.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      errors.push(...validateSchema(s.items, data[i], `${path}[${i}]`));
    }
  }

  if (Array.isArray(s.oneOf)) {
    const matches = s.oneOf.filter((sub) => validateSchema(sub, data, path).length === 0);
    if (matches.length !== 1) {
      errors.push(`${path}: expected exactly one schema match, got ${matches.length}`);
    }
  }

  if (Array.isArray(s.anyOf)) {
    const matches = s.anyOf.filter((sub) => validateSchema(sub, data, path).length === 0);
    if (matches.length === 0) {
      errors.push(`${path}: expected to match at least one of ${s.anyOf.length} schemas`);
    }
  }

  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf) {
      errors.push(...validateSchema(sub, data, path));
    }
  }

  return errors;
}

/**
 * Convenience wrapper returning a ValidationResult.
 */
export function validateSchemaResult(
  schema: JSONSchema | Record<string, unknown>,
  data: unknown,
): ValidationResult {
  const errors = validateSchema(schema, data);
  return { valid: errors.length === 0, errors };
}
