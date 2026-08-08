import { vi } from "vitest";

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
