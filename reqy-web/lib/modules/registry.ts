import type { ModuleManifest, ModuleNavItem, ModuleRouteContribution } from "./types";
import { encodeDecodeManifest } from "@/modules/encode-decode/manifest";

/**
 * Central registry of Reqly modules.
 *
 * The lifecycle is uniform for EVERY module (MTN MoMo included — no special
 * case):
 *   1. AVAILABLE  — the module manifest is known and can be installed.
 *   2. INSTALLED  — the user installed it (added to `installState`).
 *   3. ENABLED    — installed AND toggled on; the app surfaces it (nav/routes).
 *
 * `AVAILABLE` seeds first-party modules via static import. A marketplace would
 * push additional manifests through `registerAvailableModule` at runtime. The
 * install state is in-memory here; the app will back it with the global store
 * + persistence when wiring happens.
 *
 * Modules are statically imported so their code can be tree-shaken; only
 * enabled modules are surfaced by the app (nav, routes, code loading).
 */
const AVAILABLE: ModuleManifest[] = [encodeDecodeManifest];

const installState = new Map<string, boolean>();

/** Register an additional available module (marketplace / dynamic install). */
export function registerAvailableModule(manifest: ModuleManifest): void {
  if (!AVAILABLE.some((m) => m.id === manifest.id)) {
    AVAILABLE.push(manifest);
  }
}

export function getAvailableModules(): ModuleManifest[] {
  return AVAILABLE;
}

export function installModule(id: string): void {
  if (AVAILABLE.some((m) => m.id === id)) installState.set(id, true);
}

export function uninstallModule(id: string): void {
  installState.delete(id);
}

export function isInstalled(id: string): boolean {
  return installState.has(id);
}

export function setModuleEnabled(id: string, enabled: boolean): void {
  if (installState.has(id)) installState.set(id, enabled);
}

export function getInstalledModules(): ModuleManifest[] {
  return AVAILABLE.filter((m) => installState.has(m.id));
}

export function getEnabledModules(): ModuleManifest[] {
  return getInstalledModules().filter((m) => installState.get(m.id) === true);
}

export function getModuleNavItems(): ModuleNavItem[] {
  return getEnabledModules().flatMap((m) => m.nav ?? []);
}

export function getModuleRoutes(): ModuleRouteContribution[] {
  return getEnabledModules().flatMap((m) => m.routes ?? []);
}

export function getModuleById(id: string): ModuleManifest | undefined {
  return AVAILABLE.find((m) => m.id === id);
}
