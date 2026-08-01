import { inferJsonSchema, diffSchemas } from "@/lib/schema-diff";
import type { FieldChange, JsonSchema } from "@/lib/schema-diff";

const STORAGE_KEY = "reqly:rest-snapshots";

// ── Types ───────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  /** Inferred JSON schema of the response body. */
  schema: JsonSchema;
  /** HTTP status code at capture time (e.g. 200). */
  statusCode?: number;
  /** Response headers at capture time (truncated keys/values). */
  responseHeaders?: Record<string, string>;
  /** Raw response body (truncated to ~10 KB). */
  responseBody?: string;
  /** Unix-millis timestamp when the snapshot was first created. */
  createdAt: number;
  /** Unix-millis timestamp of the latest update. */
  updatedAt: number;
}

type SnapshotMap = Record<string, SnapshotEntry>;

// ── Private helpers ─────────────────────────────────────────────────────

function loadRaw(): unknown {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadSnapshots(): SnapshotMap {
  const raw = loadRaw();
  if (typeof raw !== "object" || raw === null) return {};

  // Migrate legacy entries where the value was a bare JsonSchema (v1 format)
  const map: SnapshotMap = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val && typeof val === "object" && "schema" in val) {
      // Already v2+
      map[key] = val as SnapshotEntry;
    } else if (val && typeof val === "object" && "type" in val) {
      // Legacy v1: bare JsonSchema → wrap in entry
      map[key] = {
        schema: val as JsonSchema,
        createdAt: 0,
        updatedAt: Date.now(),
      };
    }
    // else: skip corrupted entries
  }
  return map;
}

function saveSnapshots(map: SnapshotMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // If quota error, try again without responseBody fields
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      const stripped: SnapshotMap = {};
      for (const [k, v] of Object.entries(map)) {
        stripped[k] = { ...v, responseBody: undefined };
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
      } catch {
        /* give up */
      }
    }
  }
}

/** Truncate a string to ~maxBytes (UTF-8 aware-ish). */
function truncate(str: string, maxBytes: number): string {
  if (str.length <= maxBytes) return str;
  // Simple length-based truncation (good enough for detection / preview)
  return str.slice(0, maxBytes) + "\n… (truncated)";
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Persist a snapshot of `response` under `name`.
 * Optionally attach `statusCode` and `responseHeaders` for richer detail.
 */
export function saveRestSnapshot(
  name: string,
  response: unknown,
  options?: {
    statusCode?: number;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
  },
): void {
  const map = loadSnapshots();
  const existing = map[name];
  const now = Date.now();

  const entry: SnapshotEntry = {
    schema: inferJsonSchema(response),
    statusCode: options?.statusCode,
    responseHeaders: options?.responseHeaders,
    responseBody: options?.responseBody ? truncate(options.responseBody, 10_000) : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  map[name] = entry;
  saveSnapshots(map);
}

/** Returns true if a snapshot with this name already exists. */
export function hasRestSnapshot(name: string): boolean {
  return name in loadSnapshots();
}

/**
 * Compare the current `response` against the stored snapshot named `name`.
 * Returns the schema diff (empty when identical or when the name is unknown).
 */
export function compareRestSnapshot(name: string, response: unknown): FieldChange[] {
  const stored = getRestSnapshot(name);
  if (!stored) return [];
  return diffSchemas(stored, inferJsonSchema(response));
}

/** List saved snapshot names (sorted by updatedAt descending, then name). */
export function listRestSnapshots(): string[] {
  const map = loadSnapshots();
  return Object.entries(map)
    .sort((a, b) => {
      // Most recent first
      const ta = a[1].updatedAt || 0;
      const tb = b[1].updatedAt || 0;
      if (ta !== tb) return tb - ta;
      return a[0].localeCompare(b[0]);
    })
    .map(([name]) => name);
}

/** Read a full snapshot entry by name. */
export function getSnapshotEntry(name: string): SnapshotEntry | undefined {
  return loadSnapshots()[name];
}

/** Read a stored snapshot schema by name. */
export function getRestSnapshot(name: string): JsonSchema | undefined {
  return loadSnapshots()[name]?.schema;
}

/** Delete a snapshot by name. */
export function deleteRestSnapshot(name: string): void {
  const map = loadSnapshots();
  delete map[name];
  saveSnapshots(map);
}

/** Rename a snapshot (oldName → newName). Returns false if newName already exists. */
export function renameRestSnapshot(oldName: string, newName: string): boolean {
  if (oldName === newName) return true;
  if (!newName.trim()) return false;
  const map = loadSnapshots();
  if (map[newName] !== undefined) return false;
  if (map[oldName] === undefined) return false;
  map[newName] = map[oldName];
  // Preserve creation time on rename
  map[newName].updatedAt = Date.now();
  delete map[oldName];
  saveSnapshots(map);
  return true;
}
