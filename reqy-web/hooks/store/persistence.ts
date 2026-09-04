/**
 * Persistence — debounced save/load with retry, cross-tab sync, and migration.
 *
 * Extracted from use-request-store.ts (Phase 2.1).
 *
 * Usage:
 *   const pers = createPersistence();
 *   pers.debouncedSave(store, gen);        // on every commit
 *   const loaded = await pers.loadInitial(); // on init
 *   pers.setReloadHandler(set);             // connect cross-tab reload
 */

import type { RequestStore } from "@/hooks/request-types";
import type { Workspace } from "@/lib/types";
import type { SavedProject } from "@/lib/types";
import { storageAdapter } from "@/lib/storage-adapter";
import { withCrossTabSync } from "./middleware/with-cross-tab-sync";
import { WORKSPACE_PERSONAL_ID } from "./types";

const STORAGE_KEY = "reqly-request-store";

// ── Cross-tab sync (module-level singleton) ─────────────────────────────

export const crossTabSync = withCrossTabSync("reqly-store-sync");

// ── Sync cursors (per-workspace "since" timestamps) ──────────────────────

const SYNC_CURSOR_KEY = "reqly-sync-cursors";

function loadSyncCursors(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(SYNC_CURSOR_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveSyncCursor(ws: string, ts: number) {
  if (typeof localStorage === "undefined") return;
  try {
    const c = loadSyncCursors();
    c[ws] = ts;
    localStorage.setItem(SYNC_CURSOR_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export const syncCursors = { load: loadSyncCursors, save: saveSyncCursor };

// ── Defaults ────────────────────────────────────────────────────────────

const defaultEnvironments: RequestStore["environments"] = [
  {
    id: "env-global",
    name: "Global",
    color: "slate",
    workspaceId: WORKSPACE_PERSONAL_ID,
    variables: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const defaultWorkspace: Workspace = {
  id: WORKSPACE_PERSONAL_ID,
  name: "Personal",
  description: "Your personal workspace",
  color: "slate",
  icon: "folder",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/** Lit la permission système de notification directement depuis le navigateur. */
function getBrowserNotificationPermission(): string {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "unsupported";
}

// ── Migration ───────────────────────────────────────────────────────────

function migrateWorkspaceIds(store: RequestStore): RequestStore {
  const hasWorkspaces = store.workspaces && store.workspaces.length > 0;
  if (!hasWorkspaces) {
    store = {
      ...store,
      workspaces: [defaultWorkspace],
      activeWorkspaceId: store.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID,
    };
  }

  const wsId = store.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;

  return {
    ...store,
    collections: store.collections.map((c) => ({
      ...c,
      workspaceId: c.workspaceId || wsId,
    })),
    environments: store.environments.map((e) => ({
      ...e,
      workspaceId: e.workspaceId || wsId,
    })),
    history: store.history.map((h) => ({
      ...h,
      workspaceId: h.workspaceId || wsId,
    })),
    variableMappings: store.variableMappings.map((vm) => ({
      ...vm,
      workspaceId: vm.workspaceId || wsId,
    })),
  };
}

// ── Build initial store ─────────────────────────────────────────────────

export function buildInitialStore(overrides?: Partial<RequestStore>): RequestStore {
  return {
    language: "fr",
    history: [],
    collections: [],
    environments: defaultEnvironments,
    notifications: [],
    variableMappings: [],
    systemNotificationPermission: getBrowserNotificationPermission(),
    activeEnvironmentId: "env-global",
    projects: [],
    selectedProjectId: null,
    currentRequest: null,
    lastResponse: null,
    environmentVariables: {},
    collectionHistory: [],
    activeCollection: null,
    aiAutoApply: false,
    aiAudit: [],
    workspaces: [defaultWorkspace],
    activeWorkspaceId: WORKSPACE_PERSONAL_ID,
    datasets: [],
    ...overrides,
  };
}

// ── Load ────────────────────────────────────────────────────────────────

/** Fallback: if the main key does not exist, try migration from old key */
async function loadFallback(): Promise<RequestStore> {
  try {
    const { persistence } = await import("@/lib/persistence");
    const legacy = persistence.getItem<string>("probe_projects");
    const fallbackProjects: SavedProject[] = legacy ? JSON.parse(legacy) : [];
    return buildInitialStore({
      projects: fallbackProjects,
    });
  } catch {
    return buildInitialStore();
  }
}

export async function loadFromStorage(): Promise<RequestStore> {
  try {
    const stored = await storageAdapter.load(STORAGE_KEY);
    if (!stored) return await loadFallback();
    const parsed = JSON.parse(stored);
    const parsedLanguage = parsed.language === "en" ? "en" : "fr";
    return migrateWorkspaceIds({
      language: parsedLanguage,
      history: parsed.history || [],
      collections: parsed.collections || [],
      environments: parsed.environments || defaultEnvironments,
      notifications: parsed.notifications || [],
      variableMappings: parsed.variableMappings || [],
      systemNotificationPermission: getBrowserNotificationPermission(),
      activeEnvironmentId:
        parsed.activeEnvironmentId !== undefined ? parsed.activeEnvironmentId : "env-global",
      projects: parsed.projects || [],
      selectedProjectId: parsed.selectedProjectId ?? null,
      currentRequest: parsed.currentRequest ?? null,
      lastResponse: parsed.lastResponse ?? null,
      environmentVariables: parsed.environmentVariables ?? {},
      collectionHistory: Array.isArray(parsed.collectionHistory) ? parsed.collectionHistory : [],
      activeCollection: parsed.activeCollection ?? null,
      aiAutoApply: typeof parsed.aiAutoApply === "boolean" ? parsed.aiAutoApply : false,
      aiAudit: Array.isArray(parsed.aiAudit) ? parsed.aiAudit : [],
      workspaces:
        Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0
          ? parsed.workspaces
          : [defaultWorkspace],
      activeWorkspaceId: parsed.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID,
      datasets: parsed.datasets || [],
    });
  } catch (e) {
    console.warn("Migration failed:", e);
    // UX (audit 2026-09-03) : ce fallback réinitialisait le store SANS le dire
    // — l'utilisateur perdait ses collections silencieusement. Avertir
    // explicitement ; les données restent récupérables depuis le sync-server
    // au prochain pull si le workspace est synchronisé.
    try {
      const { toast } = await import("@/hooks/use-toast");
      toast({
        title: "Données locales illisibles",
        description:
          "Le stockage local était corrompu et a été réinitialisé. Si un workspace synchronisé est actif, vos collections seront restaurées à la prochaine synchronisation.",
        variant: "destructive",
      });
    } catch {
      // toast indisponible au boot très précoce — console seulement
    }
    return await loadFallback();
  }
}

// ── Filter sensitive fields before persistence ─────────────────────────

const SENSITIVE_VAR_PATTERN =
  /key|token|secret|password|passwd|credential|api_key|apikey|auth|jwt|bearer|private/i;

// Aligné sur le sanitiser sync (store-sync.ts) : toute valeur d'en-tête
// sensible (authorization, cookie, proxy-authorization, tokens…) est retirée
// AVANT écriture sur disque (IndexedDB / Tauri FS).
const SENSITIVE_HEADER_PATTERN =
  /authorization|api[-_]?key|token|secret|password|passwd|credential|cookie|private[-_]?key|bearer/i;

function sanitizeRequestEntity<T extends { authToken?: string; headers?: Record<string, string> }>(
  req: T,
): T {
  // Un brouillage du token : toute valeur présente est vidée ; une valeur
  // absente (undefined) est conservée telle quelle.
  let authToken: string | undefined;
  if (req.authToken) {
    authToken = "";
  } else {
    authToken = req.authToken;
  }

  return {
    ...req,
    authToken,
    headers: Object.fromEntries(
      Object.entries(req.headers ?? {}).filter(([name]) => !SENSITIVE_HEADER_PATTERN.test(name)),
    ),
  };
}

function sanitizeStore(store: RequestStore): RequestStore {
  return {
    ...store,
    environmentVariables: {},
    environments: store.environments.map((env) => ({
      ...env,
      variables: env.variables.map((v) => ({
        ...v,
        value: SENSITIVE_VAR_PATTERN.test(v.key) ? "" : v.value,
      })),
    })),
    collections: store.collections.map((col) => ({
      ...col,
      requests: col.requests.map((req) => sanitizeRequestEntity(req)),
    })),
    // L'historique est persisté verbatim aujourd'hui : assainir headers +
    // tokens comme pour les collections (corps laissé intact — contenu
    // saisi par l'utilisateur, pas du trafic capturé).
    history: (store.history ?? []).map((h) => sanitizeRequestEntity(h)),
    collectionHistory: (store.collectionHistory ?? []).map((h) => sanitizeRequestEntity(h)),
    currentRequest: store.currentRequest ? sanitizeRequestEntity(store.currentRequest) : null,
    lastResponse: store.lastResponse
      ? {
          ...store.lastResponse,
          headers: Object.fromEntries(
            Object.entries(store.lastResponse.headers ?? {}).filter(
              ([name]) => !SENSITIVE_HEADER_PATTERN.test(name),
            ),
          ),
        }
      : null,
  };
}

// ── Save (debounced with retries) ───────────────────────────────────────

export interface PersistenceInstance {
  /** Schedule a debounced save. Call on every commit. */
  debouncedSave(storeData: RequestStore, gen: number): void;
  /** Flush any pending save immediately. */
  flushNow(): Promise<void>;
  /** Load initial state from storage. */
  loadInitial(): Promise<RequestStore>;
  /** Connect cross-tab reload: call `reload(loadedStore)` when another tab saves. */
  setReloadHandler(reload: (store: RequestStore) => void): void;
}

/**
 * Create a persistence instance with debounced save, retry, and cross-tab sync.
 */
export function createPersistence(): PersistenceInstance {
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingStore: RequestStore | null = null;
  const MAX_SAVE_RETRIES = 3;
  const SAVE_DEBOUNCE_MS = 300;
  let lastSyncGen = 0;

  async function flushSave() {
    const store = pendingStore;
    if (!store) return;
    pendingStore = null;
    for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt++) {
      try {
        await storageAdapter.save(STORAGE_KEY, JSON.stringify(sanitizeStore(store)));
        return;
      } catch (e) {
        console.warn("[storage-adapter] save failed:", {
          attempt: attempt + 1,
          maxRetries: MAX_SAVE_RETRIES,
          error: e,
        });
        if (attempt < MAX_SAVE_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 200));
        }
      }
    }
  }

  function debouncedSave(storeData: RequestStore, localGen: number) {
    pendingStore = storeData;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      flushSave();
      crossTabSync.broadcast({ type: "update", gen: localGen });
    }, SAVE_DEBOUNCE_MS);
  }

  async function flushNow() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    await flushSave();
  }

  return {
    debouncedSave,
    flushNow,
    loadInitial: loadFromStorage,
    setReloadHandler(reload: (store: RequestStore) => void) {
      crossTabSync.onMessage(async (payload) => {
        if (payload?.type === "update" && (payload.gen || 0) > lastSyncGen) {
          lastSyncGen = payload.gen;
          const loaded = await loadFromStorage();
          reload(loaded);
        }
      });
    },
  };
}
