import { vi } from "vitest";

// Unit tests run in jsdom, which has no IndexedDB implementation. Keep the
// storage seam deterministic and in-memory; browser persistence is covered by
// E2E tests in a real browser instead.
const idbStore = new Map<IDBValidKey, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: IDBValidKey) => idbStore.get(key)),
  set: vi.fn(async (key: IDBValidKey, value: unknown) => {
    idbStore.set(key, value);
  }),
  del: vi.fn(async (key: IDBValidKey) => {
    idbStore.delete(key);
  }),
  keys: vi.fn(async () => Array.from(idbStore.keys())),
  clear: vi.fn(async () => {
    idbStore.clear();
  }),
}));

vi.mock("idb", () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(async () => []),
  clear: vi.fn(),
}));
import "@/src/i18n";

// jsdom has no IndexedDB. The storage adapter is the storage seam, so swap it
// for an in-memory implementation in unit tests instead of pulling in
// fake-indexeddb. Tests that need real IndexedDB live in e2e / the browser.
vi.mock("@/lib/storage-adapter", () => {
  const mem = new Map<string, string>();
  return {
    storageAdapter: {
      name: "Memory",
      async load(key: string): Promise<string | null> {
        return mem.get(key) ?? null;
      },
      async save(key: string, value: string): Promise<void> {
        mem.set(key, value);
      },
    },
  };
});
