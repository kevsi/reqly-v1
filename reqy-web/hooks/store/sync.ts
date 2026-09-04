/**
 * Sync engine — push, pull, WebSocket for collaborative workspaces.
 *
 * Extracted from use-request-store.ts (Phase 2.2).
 *
 * Usage:
 *   const sync = createSyncEngine({ get, commit, workspaceId });
 *   sync.pullWorkspace();        // pull remote changes
 *   sync.schedulePush();         // debounced push of local changes
 *   sync.connectWebSocket();     // start WS subscription
 *   sync.disconnectWebSocket();  // stop WS subscription
 */

import type { RequestStore } from "@/hooks/request-types";
import { toast } from "@/hooks/use-toast";
import i18n from "@/src/i18n";
import { getPublicEnv } from "@/lib/env";
import {
  mergeChangesIntoStore,
  pullAndMerge,
  computePushChanges,
  type SyncChange,
} from "@/lib/sync/store-sync";
import { pushChanges } from "@/lib/sync-client";
import { connectSyncWs, type SyncWsController } from "@/lib/sync/sync-ws";
import { syncCursors } from "./persistence";
import { WORKSPACE_PERSONAL_ID } from "./types";
import { create } from "zustand";

/** État WS de sync exposé à l'UI (badge header, audit UX 2026-09-04). */
export const useSyncStatusStore = create<{
  wsStatus: "connecting" | "open" | "error" | "closed" | "idle";
}>((set) => ({
  wsStatus: "idle" as "connecting" | "open" | "error" | "closed" | "idle",
  set: (v: "connecting" | "open" | "error" | "closed") => set({ wsStatus: v }),
}));
import { useSessionStore } from "@/lib/session-store";

// ── Types ───────────────────────────────────────────────────────────────

export interface SyncEngineDeps {
  get: () => RequestStore;
  commit: (updater: (prev: RequestStore) => RequestStore) => void;
  addNotification?: (n: { title: string; body: string; type: string }) => void;
}

export interface SyncEngine {
  /** Apply server changes into local state and persist. */
  mergeRemote: (changes: SyncChange[]) => void;
  /** Pull all changes since the last sync cursor for the given workspace. */
  pullWorkspace: (workspaceId?: string | null) => Promise<{ applied: number }>;
  /** Schedule a debounced push of local changes to the server. */
  schedulePush: (workspaceId: string) => void;
  /** Flush any pending push immediately. */
  flushPush: () => void;
  /** Start (or restart) a WS sync subscription. */
  connectWebSocket: (workspaceId: string | null) => void;
  /** Disconnect the WS subscription. */
  disconnectWebSocket: () => void;
  /** Fetch workspaces from the sync server API and merge with local metadata. */
  fetchWorkspacesFromApi: () => Promise<void>;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { get, commit } = deps;
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

  // ── Push tracking ──────────────────────────────────────────────────
  const lastPushed: Record<string, Pick<RequestStore, "collections" | "environments">> = {};
  let lastPushErrorToastAt = 0;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  // ── WebSocket ──────────────────────────────────────────────────────
  let syncWsController: SyncWsController | null = null;

  // ── Merge remote ───────────────────────────────────────────────────

  const mergeRemote = (changes: SyncChange[]) => {
    const current = get();
    const next = mergeChangesIntoStore(current, changes);
    commit(() => next);
  };

  // ── Pull workspace ─────────────────────────────────────────────────

  const pullWorkspace = async (
    workspaceId: string | null = get().activeWorkspaceId,
  ): Promise<{ applied: number }> => {
    if (!workspaceId || workspaceId === WORKSPACE_PERSONAL_ID) return { applied: 0 };
    const syncUrl = getPublicEnv().NEXT_PUBLIC_SYNC_URL;
    if (!syncUrl) return { applied: 0 };
    const since = syncCursors.load()[workspaceId] ?? 0;
    const token = useSessionStore.getState().token ?? undefined;
    const res = await pullAndMerge(workspaceId, since, { token, apply: mergeRemote });
    // Advance the cursor using the server clock so changes that landed
    // between server-now and client-now are not skipped forever (a client
    // clock running ahead of the server would otherwise cause silent loss).
    syncCursors.save(workspaceId, res.serverTime ?? Date.now());
    return res;
  };

  // ── Schedule push ──────────────────────────────────────────────────

  function schedulePush(workspaceId: string) {
    if (workspaceId === WORKSPACE_PERSONAL_ID) return;
    const syncUrl = getPublicEnv().NEXT_PUBLIC_SYNC_URL;
    if (!syncUrl) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const current = get();
      const snapshot = {
        collections: current.collections,
        environments: current.environments,
      };
      const base = lastPushed[workspaceId] ?? { collections: [], environments: [] };
      const changes = computePushChanges(base, snapshot);
      if (changes.length === 0) return;
      pushChanges(workspaceId, changes, {
        token: useSessionStore.getState().token ?? undefined,
      })
        .then((res) => {
          if (res.conflicts.length === 0) {
            lastPushed[workspaceId] = snapshot;
          } else {
            deps.addNotification?.({
              title: t("collections.sync.conflictTitle"),
              body: t("collections.sync.conflictBody", { count: res.conflicts.length }),
              type: "warning",
            });
            void pullWorkspace(workspaceId);
          }
        })
        .catch((e) => {
          console.warn("[sync] push failed:", e);
          // Feedback utilisateur (débouncé : une notification par échec, pas
          // un spam à chaque retry de 500 ms).
          const now = Date.now();
          if (now - lastPushErrorToastAt > 10_000) {
            lastPushErrorToastAt = now;
            toast({
              title: t("collections.sync.pushFailedTitle"),
              description: t("collections.sync.pushFailedBody"),
              variant: "destructive",
              meta: { event: "sync" },
            } as Parameters<typeof toast>[0]);
          }
        });
    }, 500);
  }

  function flushPush() {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────

  function connectWebSocket(workspaceId: string | null) {
    // Disconnect any previous connection
    if (syncWsController) {
      syncWsController.disconnect();
      syncWsController = null;
    }
    if (!workspaceId || workspaceId === WORKSPACE_PERSONAL_ID) return;
    const syncUrl = getPublicEnv().NEXT_PUBLIC_SYNC_URL;
    if (!syncUrl) return;

    syncWsController = connectSyncWs({
      workspaceId,
      syncUrl,
      token: useSessionStore.getState().token ?? undefined,
      onChange: () => {
        // Broadcast hint: pull the latest changes
        void pullWorkspace(workspaceId);
      },
      onError: (err) => {
        console.warn("[sync] WS error:", err.message);
      },
      onStatus: (status) => {
        useSyncStatusStore.setState({ wsStatus: status });
      },
    });
  }

  function disconnectWebSocket() {
    if (syncWsController) {
      syncWsController.disconnect();
      syncWsController = null;
    }
    useSyncStatusStore.setState({ wsStatus: "closed" });
  }

  // ── Fetch workspaces from API ──────────────────────────────────────

  const fetchWorkspacesFromApi = async () => {
    try {
      const { workspaceFetch } = await import("@/lib/workspace-api");
      const res = await workspaceFetch("/api/workspaces");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = (await res.json()) as {
        workspaces: Array<{
          id: string;
          name: string;
          ownerId: string;
          role: string;
          createdAt: number;
          updatedAt: number;
        }>;
      };

      const current = get();
      const localMeta = new Map(
        current.workspaces.map((w) => [
          w.id,
          { color: w.color, icon: w.icon, description: w.description },
        ]),
      );
      const serverWorkspaces = (data.workspaces ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        ownerId: w.ownerId,
        role: w.role,
        color: (localMeta.get(w.id)?.color ?? "slate") as
          "slate" | "red" | "orange" | "amber" | "emerald" | "blue" | "indigo" | "violet" | "pink",
        icon: localMeta.get(w.id)?.icon ?? "folder",
        description: localMeta.get(w.id)?.description ?? "",
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }));

      const personalWs = current.workspaces.find((w) => w.id === WORKSPACE_PERSONAL_ID);
      const allWorkspaces = personalWs ? [personalWs, ...serverWorkspaces] : serverWorkspaces;

      const activeId = current.activeWorkspaceId;
      const stillExists = allWorkspaces.some((w) => w.id === activeId);

      commit((prev) => ({
        ...prev,
        workspaces: allWorkspaces,
        activeWorkspaceId: stillExists
          ? activeId!
          : (allWorkspaces[0]?.id ?? WORKSPACE_PERSONAL_ID),
      }));
    } catch (e) {
      const status = e instanceof Error && /API returned (\d+)/.exec(e.message)?.[1];
      const isUnauthorized = status === "401";
      const title = isUnauthorized ? "Connexion requise" : "Synchronisation indisponible";
      const body = isUnauthorized
        ? "Les workspaces distants ne sont pas accessibles. Connectez-vous pour synchroniser vos données. Les données locales restent disponibles."
        : "Les workspaces distants n'ont pas pu être chargés. Les données locales restent disponibles. Réessayez plus tard.";
      deps.addNotification?.({ title, body, type: "warning" });
      toast({ title, description: body });
      console.warn("[workspaces] API fetch failed, using local workspaces:", e);
    }
  };

  return {
    mergeRemote,
    pullWorkspace,
    schedulePush,
    flushPush,
    connectWebSocket,
    disconnectWebSocket,
    fetchWorkspacesFromApi,
  };
}
