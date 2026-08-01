import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the EphemeralStore (lib/secure-storage).
 *
 * The module relies on `globalThis.window` to decide between a real
 * store and an SSR no-op stub, and on `globalThis.crypto` for AES-GCM
 * + PBKDF2. We provide both via beforeEach and mock @/lib/persistence
 * with a synchronous in-memory map so the test environment stays
 * deterministic and does not touch IndexedDB / localStorage.
 */

const memoryStore = new Map<string, string>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("test-passphrase"),
}));

vi.mock("@/lib/persistence", () => ({
  persistence: {
    getItem: <T = unknown>(key: string): T | null =>
      (memoryStore.get(key) as T | undefined) ?? null,
    setItem: async (key: string, value: unknown): Promise<void> => {
      memoryStore.set(key, value as string);
    },
    removeItem: async (key: string): Promise<void> => {
      memoryStore.delete(key);
    },
    keys: (): string[] => Array.from(memoryStore.keys()),
    clear: (): void => {
      memoryStore.clear();
    },
  },
}));

const STORAGE_PREFIX = "reqly-secure-";

/** Poll until predicate() returns true or timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("lib/secure-storage", () => {
  beforeEach(() => {
    memoryStore.clear();
    // Provide `window` so the module builds a real EphemeralStore rather
    // than the SSR no-op stub. Node 19+ exposes globalThis.crypto with
    // `subtle` + `randomUUID` which is what Web Crypto needs.
    (globalThis as { window?: unknown }).window = {};
    vi.resetModules();
  });

  it("silently skips a corrupted ciphertext entry instead of throwing on init", async () => {
    // 1. Encrypt + persist a value through the first store.
    const mod1 = await import("../secure-storage");
    mod1.secureKeys.set("foo", "bar");
    await waitFor(() => memoryStore.has(STORAGE_PREFIX + "foo"));
    expect(mod1.secureKeys.get("foo")).toBe("bar");

    // 2. Corrupt the ciphertext in storage so decryptValue() will throw
    //    (invalid base64 / wrong GCM tag).
    memoryStore.set(STORAGE_PREFIX + "foo", "!!!not-valid-ciphertext!!!");

    // 3. Module reload forces a fresh EphemeralStore that re-walks the
    //    persistence keys during initialize(). The corrupted entry must
    //    be swallowed by the inner try/catch.
    vi.resetModules();
    const mod2 = await import("../secure-storage");
    await mod2.secureKeys.waitForReady();

    // 4. get() returns undefined (the entry was skipped), and the
    //    store stays usable for other keys.
    expect(mod2.secureKeys.get("foo")).toBeUndefined();
    mod2.secureKeys.set("other", "value");
    expect(mod2.secureKeys.get("other")).toBe("value");
  });

  it("does not persist secure-storage entries to localStorage", async () => {
    localStorage.clear();
    const { persistence } = await import("../persistence");

    await persistence.setItem("reqly-secure-token", "ciphertext");

    expect(localStorage.getItem("reqly-secure-token")).toBeNull();
  });
});
