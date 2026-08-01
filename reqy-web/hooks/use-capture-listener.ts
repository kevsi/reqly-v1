"use client";

import { useEffect } from "react";
import { useRequestStore } from "@/hooks/use-request-store";

export function useCaptureListener() {
  const addCapturedRequest = useRequestStore((s) => s.addCapturedRequest);

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI__" in window) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        const unlisten = listen<{
          method: string;
          url: string;
          headers: Record<string, string>;
          body: string;
        }>("captured-request", (event) => {
          addCapturedRequest(event.payload);
        });
        return () => {
          unlisten.then((fn) => fn());
        };
      });
    }
  }, [addCapturedRequest]);
}
