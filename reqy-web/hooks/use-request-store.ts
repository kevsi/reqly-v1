"use client";

// ── Re-exports types (backward compat) ──────────────────────────────────

export type {
  HttpMethod,
  CollectionFolder,
  RequestItem,
  HistoryItem,
  Collection,
  EnvironmentVariable,
  Environment,
  VariableMapping,
  Notification,
  Workspace,
} from "./request-types";
export type { RequestStore } from "./request-types";
export type { Dataset } from "./store/types";

// ── Imports ─────────────────────────────────────────────────────────────

import type { Collection, HttpMethod } from "./request-types";
import type { RequestStore, CollectionFolder } from "./request-types";
import { create } from "zustand";
import { toast } from "@/hooks/use-toast";
import { downloadJson } from "@/lib/utils";

import { createPersistence, buildInitialStore } from "@/hooks/store/persistence";
import { createSyncEngine, type SyncEngine } from "@/hooks/store/sync";
import { createNotificationsMutations } from "@/hooks/store/notifications";
import { createHistoryMutations } from "@/hooks/store/history";
import { createCollectionsMutations } from "@/hooks/store/collections";
import { createFoldersMutations } from "@/hooks/store/folders";
import { createVariableMappingsMutations } from "@/hooks/store/variable-mappings";
import { createProjectsMutations } from "@/hooks/store/projects";
import { createEnvironmentsMutations } from "@/hooks/store/environments";
import { createWorkspacesMutations } from "@/hooks/store/workspaces";
import { createDatasetsMutations } from "@/hooks/store/datasets";
import { createAiActionsMutations } from "@/hooks/store/ai-actions";
import { createPreferencesMutations } from "@/hooks/store/preferences";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";
import { migrateItemAssertions } from "@/lib/test-runner/migration";

// ── Persistence (module-level singleton) ────────────────────────────────

const persistence = createPersistence();

// ── Types ───────────────────────────────────────────────────────────────

type MutationMethods = ReturnType<typeof createNotificationsMutations> &
  ReturnType<typeof createHistoryMutations> &
  ReturnType<typeof createCollectionsMutations> &
  ReturnType<typeof createFoldersMutations> &
  ReturnType<typeof createVariableMappingsMutations> &
  ReturnType<typeof createProjectsMutations> &
  ReturnType<typeof createEnvironmentsMutations> &
  ReturnType<typeof createWorkspacesMutations> &
  ReturnType<typeof createDatasetsMutations> &
  ReturnType<typeof createAiActionsMutations> &
  ReturnType<typeof createPreferencesMutations>;

type RequestStoreState = RequestStore & {
  isLoaded: boolean;
  set: (partial: Partial<RequestStore> | ((prev: RequestStore) => Partial<RequestStore>)) => void;
  get: () => RequestStore;
  commit: (updater: (prev: RequestStore) => RequestStore) => void;
  reset: () => void;
  initStore: () => Promise<void>;
  fetchWorkspacesFromApi: () => Promise<void>;
  mergeRemote: (changes: import("@/lib/sync/store-sync").SyncChange[]) => void;
  pullWorkspace: (workspaceId?: string | null) => Promise<{ applied: number }>;
  notify?: (message: string) => void;
  exportActiveRequest: (data: {
    method: string;
    url: string;
    requestHeaders: unknown;
    body: string;
    bodyType: string;
    authType: string;
    authToken: string;
    assertions: unknown;
  }) => Promise<void>;
  addCapturedRequest: (captured: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }) => void;
} & MutationMethods;

// ── Module-level state (used by sync/WS wiring) ─────────────────────────

let storeGen = 0;
let syncEngine: SyncEngine | null = null;

// ── Commit helper (used by mutations AND sync) ──────────────────────────

function createBoundCommit(
  set: (partial: Partial<RequestStore> | ((prev: RequestStore) => Partial<RequestStore>)) => void,
  _get: () => RequestStore,
) {
  return (updater: (prev: RequestStore) => RequestStore) => {
    set((prev: RequestStore) => {
      const next = updater(prev);
      storeGen++;
      persistence.debouncedSave(next, storeGen);
      const ws = prev.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
      if (ws !== WORKSPACE_PERSONAL_ID) syncEngine?.schedulePush(ws);
      return next;
    });
  };
}

// ── Store creation ──────────────────────────────────────────────────────

export const requestStore = create<RequestStoreState>()((set, get) => {
  const commit = createBoundCommit(set, get);

  // Sync engine (module-level for WS reconnect)
  syncEngine = createSyncEngine({
    get,
    commit,
    addNotification: (n) => {
      mutations.addNotification?.({
        ...n,
        type: n.type as "info" | "success" | "warning" | "error",
      });
    },
  });

  // Connect cross-tab reload
  persistence.setReloadHandler((loaded) => set(loaded));

  // Mutations
  const mutations: MutationMethods = {
    ...createNotificationsMutations(commit),
    ...createHistoryMutations(commit),
    ...createCollectionsMutations(commit),
    ...createFoldersMutations(commit),
    ...createVariableMappingsMutations(commit),
    ...createProjectsMutations(commit),
    ...createEnvironmentsMutations(commit),
    ...createWorkspacesMutations(commit),
    ...createDatasetsMutations(commit),
    ...createAiActionsMutations(commit),
    ...createPreferencesMutations(commit),
  };

  // Init store
  async function initStore() {
    let loaded = await persistence.loadInitial();

    // Migrate legacy assertions -> runnerAssertions across all collections
    if (loaded.collections && loaded.collections.length > 0) {
      loaded = {
        ...loaded,
        collections: loaded.collections.map((col) => ({
          ...col,
          requests: (col.requests || []).map((r) => migrateItemAssertions(r)),
        })),
      };
    }

    const hasDraftsCollection = loaded.collections.some((c) => c.name === "Drafts");
    if (!hasDraftsCollection) {
      const now = Date.now();
      const draftsCollection: Collection = {
        id: `col-drafts-${now}`,
        name: "Drafts",
        description: "Your drafts and uncategorized requests",
        color: "slate",
        icon: "folder",
        workspaceId: loaded.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID,
        requests: [],
        createdAt: now,
        updatedAt: now,
      };
      loaded = {
        ...loaded,
        collections: [draftsCollection, ...loaded.collections],
      };
      persistence.debouncedSave(loaded, ++storeGen);
    }

    // Capture the active workspace before load overwrites it
    const ws = get().activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
    set({
      ...loaded,
      isLoaded: true,
    } satisfies Partial<RequestStoreState>);

    // Pull remote changes for the workspace
    if (ws !== WORKSPACE_PERSONAL_ID) {
      try {
        await syncEngine!.pullWorkspace(ws);
      } catch (e) {
        console.warn("[sync] initial pull failed:", e);
      }
    }

    // Subscribe to live changes via WebSocket
    syncEngine!.connectWebSocket(ws);
  }

  // Store API
  const initial = buildInitialStore();

  const storeApi: RequestStoreState = {
    ...initial,
    isLoaded: false,
    get,
    set,
    commit,
    reset: () => {
      set(buildInitialStore());
    },
    initStore,
    fetchWorkspacesFromApi: syncEngine.fetchWorkspacesFromApi,
    mergeRemote: syncEngine.mergeRemote,
    pullWorkspace: syncEngine.pullWorkspace,
    ...mutations,
    getFoldersForCollection: (collectionId: string): CollectionFolder[] => {
      const col = get().collections?.find((c) => c.id === collectionId);
      return col?.folders ?? [];
    },
    notify: (message: string) =>
      storeApi.addNotification?.({ title: "Notification", body: String(message), type: "info" }),
    addCapturedRequest: addCapturedRequestFactory(get, commit),
    exportActiveRequest: exportActiveRequestFactory(),
  };

  return storeApi;
});

// ── Module-level exports ────────────────────────────────────────────────

export const getStore = () => requestStore.getState();
export const useRequestStore = requestStore;

export function moduleLevelCommit(updater: (prev: RequestStore) => RequestStore) {
  requestStore.getState().commit(updater);
}

// DEPRECATED: Use getStore() instead. This was a stale snapshot at module init.
export const getGlobalStore = () => requestStore.getState() as RequestStore;

// ── Workspace switch → pull + reconnect WS ──────────────────────────────

requestStore.subscribe((state, prev) => {
  if (state.activeWorkspaceId && state.activeWorkspaceId !== prev.activeWorkspaceId) {
    void state.pullWorkspace(state.activeWorkspaceId);
    syncEngine?.connectWebSocket(state.activeWorkspaceId);
  }
});

// ── Factory helpers ──────────────────────────────────────────────────────

function addCapturedRequestFactory(
  get: () => RequestStore,
  commit: (updater: (prev: RequestStore) => RequestStore) => void,
) {
  return (captured: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }) => {
    const safeMethod = (
      ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "GRAPHQL"].includes(
        captured.method?.toUpperCase(),
      )
        ? captured.method.toUpperCase()
        : "GET"
    ) as HttpMethod;

    let pathname = "";
    try {
      pathname = new URL(captured.url).pathname;
    } catch {
      pathname = captured.url;
    }

    const now = Date.now();
    const id = `req-${crypto.randomUUID()}`;

    commit((prev) => {
      const wsId = prev.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
      const drafts = prev.collections.find((c) => c.name === "Drafts");

      if (!drafts) {
        const newColId = `col-${crypto.randomUUID()}`;
        return {
          ...prev,
          collections: [
            ...prev.collections,
            {
              id: newColId,
              name: "Drafts",
              description: "Your drafts and uncategorized requests",
              color: "slate",
              icon: "folder",
              workspaceId: wsId,
              requests: [
                {
                  id,
                  name: `Captured ${safeMethod} ${pathname}`,
                  method: safeMethod,
                  url: captured.url,
                  endpoint: captured.url,
                  headers: captured.headers,
                  body: captured.body,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              folders: [],
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      }

      return {
        ...prev,
        collections: prev.collections.map((c) =>
          c.id === drafts.id
            ? {
                ...c,
                updatedAt: now,
                requests: [
                  ...c.requests,
                  {
                    id,
                    name: `Captured ${safeMethod} ${pathname}`,
                    method: safeMethod,
                    url: captured.url,
                    endpoint: captured.url,
                    headers: captured.headers,
                    body: captured.body,
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
              }
            : c,
        ),
      };
    });
  };
}

function exportActiveRequestFactory() {
  return async (requestData: {
    method: string;
    url: string;
    requestHeaders: unknown;
    body: string;
    bodyType: string;
    authType: string;
    authToken: string;
    assertions: unknown;
  }) => {
    const isTauri =
      !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
      !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;

    const jsonContent = JSON.stringify(requestData, null, 2);

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const savedPath = await invoke<string>("export_json", {
          content: jsonContent,
          defaultName: "request.json",
        });
        toast({ title: `File saved: ${savedPath}` });
      } catch (error: unknown) {
        if (error === "cancelled") return;
        toast({ title: `Export error: ${String(error)}`, variant: "destructive" });
        downloadJson(requestData, "request.json");
      }
    } else {
      downloadJson(requestData, "request.json");
      toast({ title: "Download started" });
    }
  };
}
