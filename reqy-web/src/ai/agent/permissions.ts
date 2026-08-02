import { persistence } from "@/lib/persistence";
import type { ToolPermission } from "./types";

const PERMISSIONS_KEY = "ai-tool-permissions";

// Audit complet de REQLY_TOOLS (lib/llm-tools.ts) : tout outil qui modifie l'état
// (création/renommage/suppression/exécution/délégation) DOIT être listé ici,
// sinon il héritera silencieusement de "allow". `delegate` est ajouté en Task 8.
const SIDE_EFFECT_TOOLS = new Set([
  "create_collection",
  "create_request",
  "execute_request",
  "rename_collection",
  "delete_collection",
  "create_environment",
  "update_environment_variable",
  "delegate",
]);

const READ_ONLY_TOOLS = new Set(["list_collections", "get_request_context"]);

export function isSideEffectTool(name: string): boolean {
  return SIDE_EFFECT_TOOLS.has(name);
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function defaultPermission(name: string): ToolPermission {
  return isSideEffectTool(name) ? "ask" : "allow";
}

export function loadPermissions(): Record<string, ToolPermission> {
  try {
    return persistence.getItem<Record<string, ToolPermission>>(PERMISSIONS_KEY) ?? {};
  } catch {
    return {};
  }
}

export function savePermission(name: string, perm: ToolPermission): void {
  const next = { ...loadPermissions(), [name]: perm };
  void persistence.setItem(PERMISSIONS_KEY, next);
}

export function getPermission(name: string): ToolPermission {
  return loadPermissions()[name] ?? defaultPermission(name);
}
