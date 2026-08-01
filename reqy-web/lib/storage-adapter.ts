/**
 * Storage Adapter — abstraction layer for persisting the RequestStore.
 *
 * Two implementations are provided:
 *  - IndexedDbAdapter  → used in the browser / web build (via idb-keyval)
 *  - TauriFsAdapter    → used in the Desktop (Tauri) build, writes to the OS
 *                        home directory so data survives webview cache clears.
 *
 * Features:
 *  - Error recovery with retry logic
 *  - Fallback between adapters
 *  - Structured error reporting
 */

import { get, set } from "idb-keyval"
import { isTauriAvailable } from "@/lib/tauri"
import { StorageError, IndexedDbError } from "@/lib/storage-error"
import { TauriFsAdapter } from "@/hooks/store/adapters/tauri-fs-adapter"

export interface StorageAdapter {
  load(key: string): Promise<string | null>
  save(key: string, value: string): Promise<void>
  name: string
}

// ── Retry helper ─────────────────────────────────────────────────────────────

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelayMs = 100
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxAttempts) {
        const delayMs = initialDelayMs * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  throw lastError || new Error('Retry failed with unknown error')
}

// ── IndexedDB adapter (Web) ──────────────────────────────────────────────────

const IndexedDbAdapter: StorageAdapter = {
  name: 'IndexedDB',

  async load(key: string) {
    try {
      const value = await get<string>(key)
      return value ?? null
    } catch (error) {
      throw IndexedDbError.fromUnknown(error, { operation: 'load', key })
    }
  },

  async save(key: string, value: string) {
    try {
      await retryWithBackoff(() => set(key, value), 3, 100)
    } catch (error) {
      throw IndexedDbError.fromUnknown(error, { operation: 'save', key, size: value.length })
    }
  },
}

// ── Fallback adapter (uses primary or secondary) ──────────────────────────────

class FallbackAdapter implements StorageAdapter {
  name = 'Fallback'

  constructor(
    private primary: StorageAdapter,
    private secondary: StorageAdapter
  ) {}

  async load(key: string): Promise<string | null> {
    try {
      return await this.primary.load(key)
    } catch (error) {
      console.warn(`[${this.primary.name}] load failed, trying ${this.secondary.name}:`, error)
      try {
        return await this.secondary.load(key)
      } catch (secondaryError) {
        throw StorageError.fromUnknown(error, {
          context: {
            primary: this.primary.name,
            secondary: this.secondary.name,
            primaryError: error instanceof Error ? error.message : String(error),
            secondaryError: secondaryError instanceof Error ? secondaryError.message : String(secondaryError),
          },
          recoverable: false,
        })
      }
    }
  }

  async save(key: string, value: string): Promise<void> {
    const errors: Array<{ adapter: string; error: Error }> = []

    // Try primary
    try {
      await this.primary.save(key, value)
      return
    } catch (error) {
      errors.push({
        adapter: this.primary.name,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      console.warn(`[${this.primary.name}] save failed:`, error)
    }

    // Try secondary
    try {
      await this.secondary.save(key, value)
      console.warn(`[Fallback] Successfully saved to ${this.secondary.name} after ${this.primary.name} failed`)
      return
    } catch (error) {
      errors.push({
        adapter: this.secondary.name,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      console.error(`[${this.secondary.name}] save also failed:`, error)
    }

    // Both failed
    throw new StorageError('Failed to save data to both primary and secondary storage', {
      context: {
        errors: errors.map((e) => ({ adapter: e.adapter, message: e.error.message })),
      },
      recoverable: false,
    })
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns the correct adapter based on the runtime environment.
 * - Tauri Desktop → TauriFsAdapter with IndexedDB fallback
 * - Web Browser   → IndexedDbAdapter
 */
export function createStorageAdapter(): StorageAdapter {
  if (isTauriAvailable()) {
    // Desktop: prefer Tauri FS, fallback to IndexedDB
    return new FallbackAdapter(TauriFsAdapter, IndexedDbAdapter)
  }
  // Web: use IndexedDB only
  return IndexedDbAdapter
}

// Singleton — created once on module load
export const storageAdapter = createStorageAdapter()
