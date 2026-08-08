"use client";

import { useEffect } from "react";
import { useRequestStore } from "@/hooks/use-request-store";

export function useCaptureListener() {
  const addCapturedRequest = useRequestStore((s) => s.addCapturedRequest);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI__" in window)) return;
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
