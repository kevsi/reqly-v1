/**
 * Stateful-lite store: in-memory CRUD buckets so a mock can simulate
 * create → read → update → delete flows without an external database.
 * Everything is wiped on process exit or `reset()`.
 */
export declare class MockStateStore {
    private buckets;
    list(resource: string): Array<Record<string, unknown>>;
    get(resource: string, id: string): Record<string, unknown> | null;
    create(resource: string, data: Record<string, unknown>, idField?: string): Record<string, unknown>;
    update(resource: string, id: string, patch: Record<string, unknown>, idField?: string): Record<string, unknown> | null;
    delete(resource: string, id: string): boolean;
    /** POST /mock/reset — wipe everything between test suites. */
    reset(): void;
}
/** Derive the resource bucket from a route path ("/api/users/:id" → "users"). */
export declare function resourceFromPath(path: string, explicit?: string): string;
//# sourceMappingURL=state.d.ts.map