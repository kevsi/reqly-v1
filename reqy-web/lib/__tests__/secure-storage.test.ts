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

// Test controls for @/lib/persistence: lets a test stall every setItem
// behind an unresolved promise (simulating a slow IndexedDB commit) and
// observe the exact write order.
const persistenceProbe = {
  stallWritesUntil: null as Promise<void> | null,
  writes: [] as string[],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("test-passphrase"),
}));

vi.mock("@/lib/persistence", () => ({
  persistence: {
    getItem: <T = unknown>(key: string): T | null =>
      (memoryStore.get(key) as T | undefined) ?? null,
    setItem: async (key: string, value: unknown): Promise<void> => {
      if (persistenceProbe.stallWritesUntil) {
        await persistenceProbe.stallWritesUntil;
      }
      memoryStore.set(key, value as string);
      persistenceProbe.writes.push(key);
    },
    removeItem: async (key: string): Promise<void> => {
      memoryStore.delete(key);
    },
    keys(): string[] {
      return Array.from(memoryStore.keys());
    },
    clear: (): void => {
      memoryStore.clear();
    },
  },
}));

const STORAGE_PREFIX = "reqly-secure-";
const SALT_KEY = `${STORAGE_PREFIX}salt`;

/** Poll until predicate() returns true or timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
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
    persistenceProbe.stallWritesUntil = null;
    persistenceProbe.writes.length = 0;
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

  it("awaits the new-salt persistence before deriving the key (salt race)", async () => {
    // Regression: getOrCreateSalt() used to fire storeSet() without awaiting
    // it. A reload landing before the IndexedDB commit regenerated a different
    // salt, permanently orphaning every stored ciphertext. DeriveKey must not
    // resolve until the freshly generated salt is durably persisted.

    // Defer every persistence.setItem behind this gate to simulate a slow
    // IndexedDB commit racing an app reload.
    let releaseWrites!: () => void;
    persistenceProbe.stallWritesUntil = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    // Observe when derivation actually starts.
    const realImportKey = crypto.subtle.importKey.bind(crypto.subtle);
    const importKeySpy = vi
      .spyOn(crypto.subtle, "importKey")
      .mockImplementation((...args: Parameters<SubtleCrypto["importKey"]>) =>
        realImportKey(...args),
      );
    try {
      const mod = await import("../secure-storage");
      mod.secureKeys.set("foo", "bar");

      // Give the pending chain time to (incorrectly) proceed past the gate:
      // while the salt write is stalled, key derivation must not have started.
      await new Promise((r) => setTimeout(r, 25));
      expect(memoryStore.has(SALT_KEY)).toBe(false);
      expect(importKeySpy).not.toHaveBeenCalled();

      releaseWrites();

      await waitFor(() => memoryStore.has(STORAGE_PREFIX + "foo"));
      expect(memoryStore.has(SALT_KEY)).toBe(true);
      expect(importKeySpy).toHaveBeenCalled();
      // Derivation only starts once the salt write has completed — i.e. the
      // salt is already in memoryStore at importKey call time.
      expect(
        importKeySpy.mock.calls.every(() => memoryStore.has(SALT_KEY)),
        "deriveKey ran before the salt was persisted",
      ).toBe(true);
      // Salt must hit storage strictly before the encrypted value (a late
      // write from a previous test may precede them in the shared log).
      const saltWriteIndex = persistenceProbe.writes.indexOf(SALT_KEY);
      expect(saltWriteIndex).toBeGreaterThanOrEqual(0);
      expect(persistenceProbe.writes.indexOf(STORAGE_PREFIX + "foo")).toBe(saltWriteIndex + 1);
    } finally {
      releaseWrites();
      importKeySpy.mockRestore();
    }
  });

  it("does not persist secure-storage entries to localStorage", async () => {
    localStorage.clear();
    const { persistence } = await import("../persistence");

    await persistence.setItem("reqly-secure-token", "ciphertext");

    expect(localStorage.getItem("reqly-secure-token")).toBeNull();
  });
});
