import type { ExportBundle, HttpMethod, ValidationError } from "./types.js";

const VALID_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
  "GRAPHQL",
];

export function validateExportBundle(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (data === null || typeof data !== "object") {
    return [{ path: "root", message: "Expected an object" }];
  }

  const bundle = data as Record<string, unknown>;

  if (!Array.isArray(bundle.collections)) {
    errors.push({ path: "collections", message: "Expected an array" });
    return errors;
  }

  if (bundle.collections.length === 0) {
    errors.push({ path: "collections", message: "At least one collection is required" });
  }

  bundle.collections.forEach((collection, cIndex) => {
    if (collection === null || typeof collection !== "object") {
      errors.push({ path: `collections[${cIndex}]`, message: "Expected an object" });
      return;
    }

    const col = collection as Record<string, unknown>;

    if (typeof col.name !== "string" || col.name.length === 0) {
      errors.push({ path: `collections[${cIndex}].name`, message: "Required non-empty string" });
    }

    if (!Array.isArray(col.requests)) {
      errors.push({ path: `collections[${cIndex}].requests`, message: "Expected an array" });
      return;
    }

    col.requests.forEach((request, rIndex) => {
      if (request === null || typeof request !== "object") {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}]`,
          message: "Expected an object",
        });
        return;
      }

      const req = request as Record<string, unknown>;

      if (typeof req.name !== "string" || req.name.length === 0) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].name`,
          message: "Required non-empty string",
        });
      }

      if (typeof req.method !== "string" || !VALID_METHODS.includes(req.method as HttpMethod)) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].method`,
          message: `Must be one of ${VALID_METHODS.join(", ")}`,
        });
      }

      if (typeof req.url !== "string" || req.url.length === 0) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].url`,
          message: "Required non-empty string",
        });
      }

      if (
        req.headers !== undefined &&
        (req.headers === null || typeof req.headers !== "object" || Array.isArray(req.headers))
      ) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].headers`,
          message: "Expected a record of strings",
        });
      }

      if (req.queryParams !== undefined && !Array.isArray(req.queryParams)) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].queryParams`,
          message: "Expected an array",
        });
      }

      if (req.assert !== undefined && !Array.isArray(req.assert)) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].assert`,
          message: "Expected an array of assertion objects",
        });
      }

      if (req.capture !== undefined && !Array.isArray(req.capture)) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].capture`,
          message: "Expected an array of capture objects",
        });
      }

      if (
        req.scripts !== undefined &&
        (req.scripts === null || typeof req.scripts !== "object" || Array.isArray(req.scripts))
      ) {
        errors.push({
          path: `collections[${cIndex}].requests[${rIndex}].scripts`,
          message: "Expected an object with optional 'pre' and 'post' string fields",
        });
      }
    });
  });

  if (bundle.environments !== undefined && !Array.isArray(bundle.environments)) {
    errors.push({ path: "environments", message: "Expected an array" });
  }

  if (bundle.variables !== undefined && !Array.isArray(bundle.variables)) {
    errors.push({ path: "variables", message: "Expected an array" });
  }

  return errors;
}

export function isValidExportBundle(data: unknown): data is ExportBundle {
  return validateExportBundle(data).length === 0;
}
