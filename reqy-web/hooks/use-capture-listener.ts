"use client";

import { useEffect } from "react";
import { useRequestStore } from "@/hooks/use-request-store";

/**
 * Global Tauri event listener mounted via ClientLayoutShell.
 * Adds captured requests to the global store so other parts of the app
 * (e.g. sidebar counters) stay in sync with capture activity.
 *
 * In web/browser mode this is a no-op — the capture page itself uses
 * REST polling and manages its own local state.
 */
export function useCaptureListener() {
  const addCapturedRequest = useRequestStore((s) => s.addCapturedRequest);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
    )
      return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      listen<{
        method: string;
        url: string;
        headers: Record<string, string>;
        body: string;
      }>("captured-request", (event) => {
        addCapturedRequest(event.payload);
      }).then((unlisten) => {
        if (disposed) unlisten();
        else cleanup = unlisten;
      });
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [addCapturedRequest]);
}
