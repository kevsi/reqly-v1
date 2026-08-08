import { getPublicEnv } from "./env";

export interface SyncPollOptions {
  workspaceId: string;
  since?: number;
  limit?: number;
  cursor?: string | null;
}

export interface SyncPollPage {
  changes: Array<{
    entityType: "collection" | "environment" | "folder";
    id: string;
    data: object;
    updatedAt: number;
    updatedBy: string;
    version: number;
    deleted: boolean;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  serverTime: number;
}

export interface SyncClientConfig {
  baseUrl?: string;
  token?: string;
  fetcher?: typeof fetch;
}

function getSyncBaseUrl(): string {
  try {
    return getPublicEnv().NEXT_PUBLIC_SYNC_URL || "";
  } catch {
    return "";
  }
}

export async function pollSyncChanges(
  options: SyncPollOptions,
  config: SyncClientConfig = {},
): Promise<SyncPollPage> {
  const baseUrl = config.baseUrl || getSyncBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "[sync-client] NEXT_PUBLIC_SYNC_URL is not configured. " +
        "Set it in reqy-web/.env.local or pass baseUrl explicitly.",
    );
  }

  const url = new URL("/api/sync/poll", baseUrl);
  url.searchParams.set("workspaceId", options.workspaceId);
  url.searchParams.set("since", String(options.since ?? 0));
  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options.cursor) {
    url.searchParams.set("cursor", options.cursor);
  }

  const fetcher = config.fetcher ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  const res = await fetcher(url.toString(), { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Sync poll failed" }));
    throw new Error(err.error || `Sync poll failed: ${res.status}`);
  }
  return res.json();
}

export async function* pollAllSyncChanges(
  options: Omit<SyncPollOptions, "cursor">,
  config: SyncClientConfig = {},
  onPage?: (page: SyncPollPage) => void,
): AsyncGenerator<SyncPollPage["changes"][number], void, unknown> {
  let cursor: string | null | undefined = undefined;
  do {
    const page = await pollSyncChanges({ ...options, cursor }, config);
    onPage?.(page);
    for (const change of page.changes) {
      yield change;
    }
    cursor = page.nextCursor;
  } while (cursor);
}

export interface LocalChange {
  entityType: "collection" | "environment" | "folder";
  id: string;
  data: unknown;
  updatedAt: number;
  updatedBy: string;
  baseVersion?: number;
  deleted?: boolean;
}

export interface PushResult {
  accepted: string[];
  conflicts: Array<{
    entityType: string;
    id: string;
    serverVersion: number;
    serverUpdatedAt: number;
  }>;
}

/** Push local changes to the sync server. Auth comes from the session cookie
 *  (browser/Tauri) or `config.token`; the server derives the acting user. */
export async function pushChanges(
  workspaceId: string,
  changes: LocalChange[],
  config: SyncClientConfig = {},
): Promise<PushResult> {
  const baseUrl = config.baseUrl || getSyncBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "[sync-client] NEXT_PUBLIC_SYNC_URL is not configured. " +
        "Set it in reqy-web/.env.local or pass baseUrl explicitly.",
    );
  }
  const fetcher = config.fetcher ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;

  const res = await fetcher(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workspaceId, changes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Sync push failed" }));
    throw new Error(err.error || `Sync push failed: ${res.status}`);
  }
  return res.json();
}
