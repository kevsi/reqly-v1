"use client";

/**
 * Unified persistence layer for the application.
 *
 * Uses IndexedDB (via idb-keyval) as the primary backend with a synchronous
 * in-memory cache so that existing synchronous code patterns continue to work.
 *
 * On init(), the layer:
 *  1. Loads all data from IndexedDB into the in-memory cache
 *  2. If IndexedDB is empty, falls back to localStorage (migration path)
 *  3. On every write, persists to both the cache and IndexedDB (async)
 *
 * This provides a drop-in replacement for localStorage that:
 *  - Is asynchronous (non-blocking for large writes)
 *  - Has much larger storage limits (~several hundred MB)
 *  - Survives browser cache clears
 *  - Is transactional (no data corruption on crash)
 */

import { get, set, del, keys as idbKeys, clear as idbClear } from "idb-keyval";

function isSensitiveStorageKey(key: string): boolean {
  return key.startsWith("reqly-secure-");
}

class Persistence {
  private cache = new Map<string, unknown>();
  private ready = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Eagerly populate the cache from localStorage so that synchronous
    // callers (secure-storage, state initializers, etc.) work immediately,
    // even before the async init() completes.
    this._loadFromLocalStorage();
  }

  /**
   * Initialize the persistence layer.
   * Must be called once at application startup (typically in RootLayout).
   * Safe to call multiple times — subsequent calls return the same promise.
   *
   * After init() completes, the cache is populated from IndexedDB
   * (authoritative) or from a fresh localStorage migration.
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      // Load all existing keys from IndexedDB into the cache
      const allKeys = await idbKeys();
      if (allKeys.length > 0) {
        const loadPromises = allKeys
          .filter((k): k is string => typeof k === "string")
          .map(async (key) => {
            try {
              const val = await get<unknown>(key);
              if (val !== undefined) this.cache.set(key, val);
            } catch {
              // skip corrupted entries
            }
          });
        await Promise.all(loadPromises);

        // If IndexedDB has data, it's authoritative — we're done
        this.ready = true;
        return;
      }

      // IndexedDB is empty — try migrating from localStorage
      await this._migrateFromLocalStorage();
      this.ready = true;
    } catch {
      // IndexedDB unavailable (private browsing, quota, etc.)
      // Populate cache from localStorage as best-effort fallback
      this._loadFromLocalStorage();
      this.ready = true;
    }
  }

  /** Populate cache from localStorage (fallback when IndexedDB is unavailable). */
  private _loadFromLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || isSensitiveStorageKey(k)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (raw !== null) {
          try {
            this.cache.set(k, JSON.parse(raw));
          } catch {
            this.cache.set(k, raw);
          }
        }
      } catch {
        // skip inaccessible keys
      }
    }
  }

  /**
   * One-time migration: copy all localStorage data to IndexedDB.
   * This runs once on first init and is idempotent.
   */
  private async _migrateFromLocalStorage(): Promise<void> {
    if (typeof localStorage === "undefined") return;
    const alreadyMigrated = localStorage.getItem("__persistence_migrated__");
    if (alreadyMigrated === "true") return;

    const entries: Array<[string, unknown]> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.startsWith("__persistence_") || isSensitiveStorageKey(k)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (raw === null) continue;
        // Try to parse as JSON; fall back to raw string
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        entries.push([k, parsed]);
      } catch {
        // skip inaccessible keys
      }
    }

    if (entries.length > 0) {
      // Bulk-add to IndexedDB (faster than individual set calls)
      await Promise.all(entries.map(([k, v]) => set(k, v)));
    }

    // Populate cache
    for (const [k, v] of entries) {
      this.cache.set(k, v);
    }

    localStorage.setItem("__persistence_migrated__", "true");
    console.log(`[persistence] Migrated ${entries.length} keys from localStorage to IndexedDB`);
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Returns true once the persistence layer has finished initialising.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Resolves when the persistence layer is fully initialised.
   */
  async waitForReady(): Promise<void> {
    if (this.ready) return;
    await this.init();
  }

  /**
   * Read a value from the store.
   *
   * Synchronous — returns from the in-memory cache.
   * Falls back to localStorage for backward compatibility during migration.
   */
  getItem<T = unknown>(key: string): T | null {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }

    if (isSensitiveStorageKey(key)) {
      return null;
    }

    // Fallback: try localStorage directly (for keys written by old code that
    // hasn't been migrated yet, or during the brief window before init)
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        try {
          return JSON.parse(raw) as T;
        } catch {
          return raw as unknown as T;
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Write a value to the store.
   *
   * Writes go to the in-memory cache immediately (sync) and persist to
   * IndexedDB asynchronously. Also cleans up any stale localStorage copy.
   */
  async setItem(key: string, value: unknown): Promise<void> {
    this.cache.set(key, value);

    if (!isSensitiveStorageKey(key)) {
      // Keep localStorage in sync so synchronous reads on the NEXT page load
      // (before the async init() completes) still find the value.
      try {
        localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
      } catch {
        // ignore
      }
    }

    try {
      await set(key, value);
    } catch (e) {
      console.warn("[persistence] IndexedDB write failed:", e);
    }
  }

  /**
   * Remove a key from the store.
   */
  async removeItem(key: string): Promise<void> {
    this.cache.delete(key);

    try {
      await del(key);
    } catch {
      // ignore
    }

    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  /**
   * Clear all data.
   */
  async clear(): Promise<void> {
    this.cache.clear();

    try {
      await idbClear();
    } catch {
      // ignore
    }

    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  }

  /**
   * Return all keys currently in the cache.
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Return all entries currently in the cache.
   */
  entries(): Array<[string, unknown]> {
    return Array.from(this.cache.entries());
  }
}

export const persistence = new Persistence();
