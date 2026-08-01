"use client";

import { useEffect, type ReactNode } from "react";
import { persistence } from "@/lib/persistence";
import { useCaptureListener } from "@/hooks/use-capture-listener";

/**
 * Client-side wrapper mounted inside the server `RootLayout` body.
 * Also boots the persistence layer (IndexedDB load + localStorage migration)
 * once on mount so that IDB is authoritative before any subscriber reads.
 */
export function ClientLayoutShell({ children }: { children: ReactNode }) {
  useCaptureListener();

  useEffect(() => {
    persistence.waitForReady().catch((err) => {
      console.error("[persistence] init failed:", err);
    });
  }, []);

  return <>{children}</>;
}
