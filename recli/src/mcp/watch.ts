import { watch } from "chokidar";
import fs from "node:fs";
import type { CollectionStore } from "./store.js";

export interface BundleWatcher {
  close(): void;
  /** Call after writing the bundle to the same path to suppress self-triggered reloads. */
  markWritten(content: string): void;
}

/**
 * Watch a bundle file and hot-reload the store on external edits.
 *
 * Guards against self-triggered events (our own persist callback writes) via a
 * content-comparison heuristic.  Debounces rapid successive events by 200 ms.
 */
export function watchBundleFile(
  bundlePath: string,
  store: CollectionStore,
  log: (msg: string) => void,
): BundleWatcher {
  let lastLoaded: string | null = safeRead();
  let lastWritten: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function safeRead(): string | null {
    try {
      return fs.readFileSync(bundlePath, "utf8");
    } catch {
      return null;
    }
  }

  const watcher = watch(bundlePath, { ignoreInitial: true });
  watcher.on("change", () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 200);
  });

  function reload(): void {
    const content = safeRead();
    if (content === null) return;
    // Skip our own writes (or reads of identical content).
    if (content === lastWritten || content === lastLoaded) {
      lastLoaded = content;
      return;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // Minimal structural check before loading — avoid clobbering with junk.
      if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.collections)) {
        log("Ignored malformed bundle change (no collections array)");
        return;
      }
      store.loadFromBundle(parsed as any);
      lastLoaded = content;
      log(`Hot-reloaded bundle: ${bundlePath}`);
    } catch {
      log(`Failed to parse bundle during hot-reload: ${bundlePath}`);
    }
  }

  return {
    close: () => {
      clearTimeout(timer);
      watcher.close();
    },
    markWritten(content) {
      lastWritten = content;
    },
  };
}
