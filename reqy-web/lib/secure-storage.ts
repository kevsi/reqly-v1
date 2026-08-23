"use client";

import { invoke } from "@tauri-apps/api/core";

/**
 * Secure storage for API keys and tokens.
 *
 * Uses AES-256-GCM encryption via the Web Crypto API with a key derived
 * from a passphrase provided by the Tauri backend (per-session secret).
 *
 * THREAT MODEL DECISION (2026-07-28): See `docs/adr/001-indexdb-encryption-threat-model.md`.
 * Decision chosen: Session secret via Tauri IPC. The encryption passphrase
 * is provided by the Tauri backend at startup and held only in Rust process memory,
 * never written to disk.  This protects against XSS-based exfiltration and
 * casual filesystem access, but NOT against a compromised Tauri sidecar.
 * For a desktop mono-user app, this provides the right threat/cost trade-off.
 *
 * Security note: this is NOT suitable for high-value secrets against a
 * determined attacker with full filesystem access, but the session secret
 * model provides the right protection for the current threat model.
 */

const STORAGE_PREFIX = "reqly-secure-";
const SALT_KEY = `${STORAGE_PREFIX}salt`;

// ---- Storage helpers (IndexedDB via persistence layer) -----------------

import { persistence } from "@/lib/persistence";

function storeGet(key: string): string | null {
  try {
    const val = persistence.getItem<string>(key);
    return val ?? null;
  } catch {
    return null;
  }
}

async function storeSet(key: string, value: string): Promise<void> {
  try {
    await persistence.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

async function storeRemove(key: string): Promise<void> {
  try {
    await persistence.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---- Crypto helpers ---------------------------------------------------
// Passphrase comes from Tauri (not stored persistently in localStorage).

let cachedKey: CryptoKey | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

async function getKey(passphrase: string): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!keyPromise) {
    keyPromise = deriveKey(passphrase);
  }
  cachedKey = await keyPromise;
  return cachedKey;
}

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltBytes = await getOrCreateSalt();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 600000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function getOrCreateSalt(): Promise<Uint8Array> {
  const existing = storeGet(SALT_KEY);
  if (existing) {
    try {
      return Uint8Array.from(atob(existing), (c) => c.charCodeAt(0));
    } catch {
      /* corrupted — regenerate */
    }
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoded = btoa(String.fromCharCode(...salt));
  // Await the persistence commit before handing the new salt to the caller.
  // Fire-and-forget here let a reload before the IndexedDB write complete
  // regenerate a different salt, making every stored value undecryptable.
  await storeSet(SALT_KEY, encoded);
  return salt;
}

async function encryptValue(plaintext: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  const cipherBytes = new Uint8Array(encrypted);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv);
  combined.set(cipherBytes);
  const binary = combined.reduce(
    (acc: string, byte: number) => acc + String.fromCharCode(byte),
    "",
  );
  return btoa(binary);
}

async function decryptValue(ciphertext: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

// ---- Store -------------------------------------------------------------
// Passphrase is provided by the Tauri backend (not stored persistently).

class EphemeralStore {
  private syncStore = new Map<string, string>();
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private initPromise: Promise<void>;
  private passphrase: string | null = null;

  constructor() {
    this.initPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      this.passphrase = await invoke<string>("get_encryption_passphrase");
      // Walk persistence keys for encrypted entries (IndexedDB only; sensitive storage is not mirrored to localStorage)
      const allKeys = persistence.keys();
      for (const k of allKeys) {
        if (k.startsWith(STORAGE_PREFIX)) {
          try {
            const encrypted = persistence.getItem<string>(k);
            if (encrypted && this.passphrase) {
              const key = await getKey(this.passphrase);
              const plain = await decryptValue(encrypted, key);
              this.syncStore.set(k.substring(STORAGE_PREFIX.length), plain);
            }
          } catch {
            // entry corrupted or key mismatch — skip
          }
        }
      }
      this.ready = true;
    } catch {
      // crypto unavailable or Tauri backend not available — store remains empty but operational
      this.ready = true;
    }
    this.readyResolve?.();
  }

  /** Await the initial decryption pass before first read. */
  async waitForReady(): Promise<void> {
    await this.initPromise;
  }

  set(key: string, value: string): void {
    this.syncStore.set(key, value);
    if (this.passphrase) {
      getKey(this.passphrase)
        .then((k) => encryptValue(value, k))
        .then(async (encrypted) => {
          await storeSet(STORAGE_PREFIX + key, encrypted);
        })
        .catch((err) => {
          // Encryption or persistence failed — value is held in memory only
          // and WILL be lost on page reload.  Surface a warning so callers
          // know the operation didn't fully succeed.
          console.warn(
            "[secure-storage] failed to persist encrypted value for key " +
              `"${key}": ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  }

  get(key: string): string | undefined {
    return this.syncStore.get(key);
  }

  delete(key: string): void {
    this.syncStore.delete(key);
    storeRemove(STORAGE_PREFIX + key);
  }

  clear(): void {
    this.syncStore.clear();
    const prefixedKeys = persistence.keys().filter((k) => k.startsWith(STORAGE_PREFIX));
    for (const k of prefixedKeys) {
      persistence.removeItem(k);
    }
  }
}

/**
 * SSR-safe stub for the EphemeralStore.
 *
 * Secure storage only exists in the browser (Web Crypto + IndexedDB +
 * localStorage). Importing this module during SSR would otherwise call
 * IndexedDB at module-evaluation time and pollute the server logs (and
 * eventually crash if Node lacks the global). We substitute a no-op stub
 * whose methods silently succeed/return undefined.
 */
function createNoOpStore(): EphemeralStore {
  const noop = () => {};
  return {
    set: noop,
    get: () => undefined,
    delete: noop,
    clear: noop,
    waitForReady: async () => {},
  } as unknown as EphemeralStore;
}

export const secureKeys: EphemeralStore =
  typeof window !== "undefined" ? new EphemeralStore() : createNoOpStore();
