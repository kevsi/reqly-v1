import type { StorageAdapter } from "@/lib/storage-adapter"
import { TauriError } from "@/lib/storage-error"

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
  throw lastError || new Error("Retry failed with unknown error")
}

async function ensureAppDataDir(): Promise<void> {
  const [{ appDataDir }, { mkdir }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ])
  const dir = await appDataDir()
  await mkdir(dir, { recursive: true })
}

export const TauriFsAdapter: StorageAdapter = {
  name: "Tauri FS",

  async load(key: string) {
    try {
      const { BaseDirectory, readTextFile } = await import("@tauri-apps/plugin-fs")
      const filename = `${key}.json`
      const text = await readTextFile(filename, { baseDir: BaseDirectory.AppData })
      return text
    } catch (error) {
      // Tauri plugin-fs surfaces Rust std::io::ErrorKind via the structured `code`
      // field (e.g. "ENOENT"). Using the structured code avoids false positives
      // from substring matching against user-controlled paths or translated
      // messages. Audit finding 5.1.
      const code = (error as { code?: string })?.code
      if (code === "ENOENT") {
        return null
      }
      throw TauriError.fromUnknown(error, { operation: "load", key })
    }
  },

  async save(key: string, value: string) {
    try {
      await retryWithBackoff(async () => {
        const { BaseDirectory, writeTextFile } = await import("@tauri-apps/plugin-fs")
        await ensureAppDataDir()
        const filename = `${key}.json`
        await writeTextFile(filename, value, { baseDir: BaseDirectory.AppData })
      }, 3, 100)
    } catch (error) {
      throw TauriError.fromUnknown(error, { operation: "save", key, size: value.length })
    }
  },
}
