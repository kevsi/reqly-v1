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
          message: "Expected an array of assertions (strings or objects)",
        });
      } else if (Array.isArray(req.assert)) {
        req.assert.forEach((entry, aIndex) => {
          const aPath = `collections[${cIndex}].requests[${rIndex}].assert[${aIndex}]`;
          if (typeof entry === "string") return; // text format: "status == 200"
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            errors.push({
              path: aPath,
              message: "Expected a string (text expression) or an assertion object",
            });
            return;
          }
          const a = entry as Record<string, unknown>;
          const hasExpr = typeof a.expr === "string" && a.expr.trim().length > 0;
          const hasType = typeof a.type === "string" && a.type.trim().length > 0;
          const hasSchema =
            a.schema !== undefined && a.schema !== null && typeof a.schema === "object";
          if (!hasExpr && !hasType && !hasSchema) {
            errors.push({
              path: aPath,
              message:
                'Assertion must have a text "expr", a structured "type", or a "schema" ' +
                '(e.g. { "expr": "status == 200" })',
            });
          }
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

/**
 * Scan the bundle for `{{name}}` placeholders that resolve to nothing.
 * Returns warning-shaped entries (NOT hard errors): a name is considered
 * defined if it appears in bundle.variables, any environment, any capture,
 * or is assigned by any script (`env.set`, `pm.environment.set`, legacy
 * `postman.setEnvironmentVariable`, …). Dynamic `{{$...}}` names are skipped.
 *
 * ponytail: this is a static heuristic, so it has known blind spots (all
 * warning-only, never fatal): a var set via a computed name
 * (`vars.set("prefix" + i, v)`), provided only via process.env/.env at run
 * time, or interpolated inside an assert `expr` (not scanned) may be flagged
 * or missed. The run-time warning in the runner is the authoritative check;
 * tightening the static scan would require executing scripts.
 */
export function findUnresolvedVariables(bundle: ExportBundle): ValidationError[] {
  const warnings: ValidationError[] = [];
  const defined = new Set<string>();

  const addVar = (v: unknown): void => {
    if (v !== null && typeof v === "object") {
      const key = (v as Record<string, unknown>).key;
      if (typeof key === "string" && key) defined.add(key);
    }
  };
  for (const v of bundle.variables ?? []) addVar(v);
  for (const env of bundle.environments ?? []) for (const v of env.variables ?? []) addVar(v);

  // Names assigned by capture rules or scripts are runtime-defined.
  for (const col of bundle.collections) {
    for (const req of col.requests ?? []) {
      for (const c of req.capture ?? []) if (c && typeof c.name === "string") defined.add(c.name);
      for (const s of [req.scripts?.pre ?? "", req.scripts?.post ?? ""]) {
        const m = s.matchAll(
          /\.(?:set|setEnvironmentVariable|setGlobalVariable)\s*\(\s*["']([^"']+)["']/g,
        );
        for (const hit of m) defined.add(hit[1]);
      }
    }
  }

  const scan = (text: unknown): Set<string> => {
    const found = new Set<string>();
    if (typeof text !== "string") return found;
    for (const m of text.matchAll(/\{\{([^}]+)\}\}/g)) {
      const name = m[1].trim();
      if (name.startsWith("$")) continue; // dynamic variable
      if (!defined.has(name)) found.add(name);
    }
    return found;
  };

  bundle.collections.forEach((col, cIndex) => {
    (col.requests ?? []).forEach((req, rIndex) => {
      const names = new Set<string>();
      for (const n of scan(req.url)) names.add(n);
      for (const v of Object.values(req.headers ?? {})) for (const n of scan(v)) names.add(n);
      for (const qp of req.queryParams ?? []) {
        for (const n of scan(qp?.key)) names.add(n);
        for (const n of scan(qp?.value)) names.add(n);
      }
      for (const n of scan(req.body)) names.add(n);
      for (const n of scan(req.graphql?.query)) names.add(n);
      if (names.size > 0) {
        warnings.push({
          path: `collections[${cIndex}].requests[${rIndex}].url`,
          message:
            `Unresolved variable(s): ${[...names].join(", ")} — define them in ` +
            "bundle.variables, an environment, or a .env file",
        });
      }
    });
  });

  return warnings;
}
