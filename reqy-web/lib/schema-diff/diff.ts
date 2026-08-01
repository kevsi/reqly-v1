import type { FieldChange, JsonSchema } from "./types";

/**
 * Deep-walk two JSON schemas and emit a `FieldChange` for every field that is
 * `added` (present in new, absent in old), `removed` (present in old, absent
 * in new), or `type-changed` (same path, different type). Recurses into nested
 * objects and array `items`. Array item paths are suffixed with `[]`.
 */
export function diffSchemas(oldS: JsonSchema, newS: JsonSchema, basePath = ""): FieldChange[] {
  const changes: FieldChange[] = [];
  walk(oldS, newS, basePath, changes);
  return changes;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function walk(oldS: JsonSchema, newS: JsonSchema, path: string, changes: FieldChange[]): void {
  // Compare this node's own type first. At the root (empty path) a top-level
  // type swap is not reported — the root is always an object envelope.
  if (oldS.type !== newS.type) {
    if (path) {
      changes.push({
        path,
        kind: newS.type === "null" ? "type-changed:null" : "type-changed",
        from: oldS.type,
        to: newS.type,
      });
    }
    return;
  }

  if (oldS.type === "array") {
    if (oldS.items && newS.items) {
      walk(oldS.items, newS.items, `${path}[]`, changes);
    }
    return;
  }

  if (oldS.type === "object") {
    const oldProps = oldS.properties ?? {};
    const newProps = newS.properties ?? {};

    for (const key of Object.keys(oldProps)) {
      if (!(key in newProps)) {
        changes.push({
          path: joinPath(path, key),
          kind: "removed",
          from: oldProps[key].type,
        });
      }
    }

    for (const key of Object.keys(newProps)) {
      if (!(key in oldProps)) {
        changes.push({
          path: joinPath(path, key),
          kind: "added",
          to: newProps[key].type,
        });
      }
    }

    for (const key of Object.keys(oldProps)) {
      if (!(key in newProps)) continue;
      walk(oldProps[key], newProps[key], joinPath(path, key), changes);
    }
  }
}
