import { isTauriAvailable } from "@/lib/tauri";
import { getPublicEnv } from "@/lib/env";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { useSessionStore } from "@/lib/session-store";

/**
 * Unified workspace API client.
 *
 * On the web build, requests go through the Next.js proxy at `/api/workspaces*`
 * (which forwards to the sync backend with the service token). On the desktop
 * (Tauri) build there is no Next server, so we call the sync backend
 * (`NEXT_PUBLIC_SYNC_URL`) directly — mirroring how `lib/sync-client.ts` already
 * talks to SYNC_URL. This keeps workspace features working in the static Tauri
 * export where Next API routes are not available.
 *
 * @param syncPath  Path on the sync backend, e.g. `/api/workspaces` or
 *                  `/api/memberships` (join).
 * @param init      Standard fetch init (method, body, headers, ...).
 * @param webPath   Path used on the web build (Next proxy). Defaults to
 *                  `syncPath`; differs only for the join endpoint, whose Next
 *                  route (`/api/workspaces/join`) proxies to `/api/memberships`
 *                  on the sync backend.
 */
export async function workspaceFetch(
  syncPath: string,
  init: RequestInit = {},
  webPath: string = syncPath,
): Promise<Response> {
  const desktop = isTauriAvailable();

  if (desktop) {
    const syncUrl = getPublicEnv().NEXT_PUBLIC_SYNC_URL?.replace(/\/$/, "") ?? "";
    if (!syncUrl) {
      throw new Error(
        "[workspace-api] NEXT_PUBLIC_SYNC_URL is not configured. Workspaces are unavailable in desktop mode.",
      );
    }
    const headers = new Headers(init.headers);
    // Prefer the real user session token when the user is authenticated;
    // otherwise fall back to the service token (dev / unauthenticated).
    const sessionToken = useSessionStore.getState().token;
    if (sessionToken) {
      headers.set("Authorization", `Bearer ${sessionToken}`);
    } else {
      for (const [key, value] of Object.entries(proxyAuthHeaders())) {
        headers.set(key, value);
      }
    }
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(`${syncUrl}${syncPath}`, { ...init, headers });
  }

  // On the web build, pass the session token so the Next.js proxy route
  // can forward it to the sync server for authentication.
  const headers = new Headers(init.headers);
  const sessionToken = useSessionStore.getState().token;
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(webPath, { ...init, headers });
}
