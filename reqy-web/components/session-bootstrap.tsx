"use client";

import { useEffect } from "react";
import { useSessionStore } from "@/lib/session-store";

/**
 * Restores a persisted session on app startup. Renders nothing.
 * Mounted once in the root layout so the session token (if any) is
 * validated against `/api/auth/me` before the UI assumes auth state.
 */
export function SessionBootstrap() {
  useEffect(() => {
    void useSessionStore.getState().restore();
  }, []);
  return null;
}
