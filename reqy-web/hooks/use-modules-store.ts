import { useSyncExternalStore } from "react";
import {
  getAvailableModules,
  installModule as regInstall,
  uninstallModule as regUninstall,
  setModuleEnabled as regSetEnabled,
} from "@/lib/modules/registry";
import type { ModuleManifest, ModuleNavItem } from "@/lib/modules/types";

/**
 * Reactive + persisted install state for modules.
 *
 * The registry in `lib/modules/registry.ts` owns the *catalog* (what modules
 * exist) and pure selectors; this store owns the *install/enabled state* and
 * makes it reactive (so the Settings UI updates) and persistent (localStorage),
 * so a user's installed modules survive reloads.
 *
 * Every mutation keeps the registry's in-memory install state in sync (via the
 * registry's own install functions) and persists to localStorage.
 */

const STORAGE_KEY = "reqly_modules_install";

export type ModuleInstallState = Record<string, boolean>; // id -> enabled

let state: ModuleInstallState = load();
const listeners = new Set<() => void>();

function load(): ModuleInstallState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ModuleInstallState) : {};
  } catch {
    return {};
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function syncRegistry(): void {
  for (const m of getAvailableModules()) {
    const enabled = state[m.id];
    if (enabled !== undefined) {
      regInstall(m.id);
      regSetEnabled(m.id, enabled === true);
    } else {
      regUninstall(m.id);
    }
  }
}

function commit(): void {
  syncRegistry();
  persist();
  for (const l of listeners) l();
}

// Sync the registry with any persisted state on first import.
syncRegistry();

export function installModule(id: string): void {
  state = { ...state, [id]: true };
  commit();
}

export function uninstallModule(id: string): void {
  const next = { ...state };
  delete next[id];
  state = next;
  commit();
}

export function setModuleEnabled(id: string, enabled: boolean): void {
  state = { ...state, [id]: enabled };
  commit();
}

export function getModuleState(id: string): { installed: boolean; enabled: boolean } {
  const enabled = state[id];
  return { installed: enabled !== undefined, enabled: enabled === true };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ModuleInstallState {
  return state;
}

export function useModuleInstallState(): ModuleInstallState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface AvailableModuleView extends ModuleManifest {
  installed: boolean;
  enabled: boolean;
}

export function useAvailableModules(): AvailableModuleView[] {
  const s = useModuleInstallState();
  return getAvailableModules().map((m) => ({
    ...m,
    installed: s[m.id] !== undefined,
    enabled: s[m.id] === true,
  }));
}

/** Reactive list of nav items for every *enabled* module (surfaced in the app). */
export function useEnabledModuleNav(): ModuleNavItem[] {
  return useAvailableModules()
    .filter((m) => m.enabled)
    .flatMap((m) => m.nav ?? []);
}

/** Reactive flag: is the given module currently installed AND enabled? */
export function useIsModuleEnabled(id: string): boolean {
  const s = useModuleInstallState();
  return s[id] === true;
}
