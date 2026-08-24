import { randomUUID } from "node:crypto";

/**
 * Stateful-lite store: in-memory CRUD buckets so a mock can simulate
 * create → read → update → delete flows without an external database.
 * Everything is wiped on process exit or `reset()`.
 */
export class MockStateStore {
  private buckets = new Map<string, Map<string, Record<string, unknown>>>();

  list(resource: string): Array<Record<string, unknown>> {
    return [...(this.buckets.get(resource)?.values() ?? [])];
  }

  get(resource: string, id: string): Record<string, unknown> | null {
    return this.buckets.get(resource)?.get(id) ?? null;
  }

  create(resource: string, data: Record<string, unknown>, idField = "id"): Record<string, unknown> {
    let bucket = this.buckets.get(resource);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(resource, bucket);
    }
    let id = data[idField];
    if (typeof id !== "string" && typeof id !== "number") {
      id = randomUUID();
      data = { ...data, [idField]: id };
    }
    bucket.set(String(id), { ...data });
    return { ...data };
  }

  update(
    resource: string,
    id: string,
    patch: Record<string, unknown>,
    idField = "id",
  ): Record<string, unknown> | null {
    const existing = this.get(resource, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch, [idField]: id };
    this.buckets.get(resource)?.set(id, merged);
    return { ...merged };
  }

  delete(resource: string, id: string): boolean {
    return this.buckets.get(resource)?.delete(id) ?? false;
  }

  /** POST /mock/reset — wipe everything between test suites. */
  reset(): void {
    this.buckets.clear();
  }
}

/** Derive the resource bucket from a route path ("/api/users/:id" → "users"). */
export function resourceFromPath(path: string, explicit?: string): string {
  if (explicit) return explicit;
  const seg = path.split("/").filter((s) => s.length > 0 && !s.startsWith(":"));
  return seg[0] ?? "resources";
}
