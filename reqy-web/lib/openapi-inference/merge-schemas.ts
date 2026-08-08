/**
 * Merge two OpenAPI schema objects into one.
 *
 * Strategy (in priority order):
 * 1. Identical schemas → return as-is (no-op).
 * 2. Both are "object" schemas with `properties` → deep-merge properties;
 *    inferred schema wins on conflicts (more specific wins over generic).
 * 3. Otherwise → emit `allOf: [generic, inferred]` as a safe fallback.
 */
export function mergeInferredWithGeneric(
  inferred: Record<string, unknown>,
  generic: Record<string, unknown>,
): Record<string, unknown> {
  // Fast path: identical schemas
  if (JSON.stringify(inferred) === JSON.stringify(generic)) return inferred;

  const inferredType = inferred.type;
  const genericType = generic.type;

  // Deep-merge object schemas
  if (
    inferredType === "object" &&
    genericType === "object" &&
    isPropertiesObject(inferred.properties) &&
    isPropertiesObject(generic.properties)
  ) {
    const mergedProperties: Record<string, unknown> = {
      ...generic.properties,
      ...inferred.properties,
    };

    // Recursively merge overlapping property schemas
    for (const key of Object.keys(inferred.properties as Record<string, unknown>)) {
      const inferredProp = (inferred.properties as Record<string, unknown>)[key];
      const genericProp = (generic.properties as Record<string, unknown>)[key];
      if (genericProp && isSchemaObject(inferredProp) && isSchemaObject(genericProp)) {
        mergedProperties[key] = mergeInferredWithGeneric(inferredProp, genericProp);
      }
    }

    // Merge required arrays (union)
    const inferredRequired = Array.isArray(inferred.required)
      ? (inferred.required as string[])
      : [];
    const genericRequired = Array.isArray(generic.required) ? (generic.required as string[]) : [];
    const mergedRequired = Array.from(new Set([...genericRequired, ...inferredRequired]));

    return {
      type: "object",
      properties: mergedProperties,
      ...(mergedRequired.length > 0 ? { required: mergedRequired } : {}),
    };
  }

  // Array schemas: merge items
  if (
    inferredType === "array" &&
    genericType === "array" &&
    isSchemaObject(inferred.items) &&
    isSchemaObject(generic.items)
  ) {
    return {
      type: "array",
      items: mergeInferredWithGeneric(
        inferred.items as Record<string, unknown>,
        generic.items as Record<string, unknown>,
      ),
    };
  }

  // Inferred type takes precedence when types differ but inferred is more specific
  if (inferredType && inferredType !== genericType) {
    return inferred;
  }

  // Default safe fallback
  return { allOf: [generic, inferred] };
}

function isSchemaObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPropertiesObject(v: unknown): v is Record<string, unknown> {
  return isSchemaObject(v);
}
