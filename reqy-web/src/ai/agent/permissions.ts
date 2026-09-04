import { persistence } from "@/lib/persistence";
import type { ToolPermission } from "./types";

const PERMISSIONS_KEY = "ai-tool-permissions";

// Un outil absent des listes est refusé par défaut afin qu'un ajout futur ne
// puisse pas hériter silencieusement d'une autorisation.
const SIDE_EFFECT_TOOLS = new Set([
  "create_collection",
  "create_request",
  "execute_request",
  "execute_requests",
  "rename_collection",
  "delete_collection",
  "delete_environment",
  "create_environment",
  "update_environment_variable",
  "delegate",
  // Équipe d'agents en parallèle : coût tokens multiple, régime delegate.
  "delegate_team",
  "run_collection",
  "import_collection",
  "switch_workspace",
  "duplicate_collection",
  "delete_request",
  "move_request",
  "create_folder",
  "update_request",
  "set_request_body",
  "rename_folder",
  "delete_folder",
  "move_request_to_folder",
  "set_active_environment",
  "duplicate_workspace",
  "archive_workspace",
  "unarchive_workspace",
  "clear_workspace_cache",
  // Mock Server : remplace le brouillon de routes (confirmé par l'UI).
  "replace_mock_draft",
  // Capture proxy : génère et applique un mock depuis le trafic réel.
  "generate_mock_from_capture",
  // Actions du dispatcher JSON historique.
  "legacy_fill_request",
  "legacy_add_assertions",
  "legacy_create_variable",
  "legacy_apply_fix",
  "legacy_generate_doc",
  "legacy_execute_request",
  "legacy_run_batch",
]);

const READ_ONLY_TOOLS = new Set([
  "list_collections",
  "list_environments",
  "get_environment",
  "get_request_context",
  "search_requests",
  "explain_response",
  "propose_assertion_fix",
  "export_collection",
  "list_workspaces",
  "get_current_workspace",
  "get_workspace",
  "search_workspaces",
  "get_workspace_stats",
  "list_history",
  "get_history_entry",
  // Mock Server : lecture du brouillon + validation pure.
  "get_mock_draft",
  "validate_mock_config",
  // Capture proxy : lecture des sessions capturées.
  "get_capture_sessions",
  // Git read-only (dépôt ouvert dans le panneau Git).
  "git_status",
  "git_branches",
  "git_diff",
]);

// Ces outils ne peuvent jamais recevoir allow persistant ni autoApply.
const HIGH_IMPACT_TOOLS = new Set([
  "execute_request",
  "execute_requests",
  "run_collection",
  "delete_collection",
  "delete_environment",
  "delete_request",
  "delete_folder",
  "import_collection",
  "update_environment_variable",
  "update_request",
  "move_request_to_folder",
  "delegate",
  "delegate_team",
  "switch_workspace",
  "duplicate_workspace",
  "archive_workspace",
  "clear_workspace_cache",
  "move_request",
  "legacy_execute_request",
  "legacy_run_batch",
]);

export type ApprovalSource = "none" | "user" | "plan" | "code" | "autoApply";

export interface ToolAuthorizationDecision {
  tool: string;
  permission: ToolPermission;
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
}

export function isSideEffectTool(name: string): boolean {
  return SIDE_EFFECT_TOOLS.has(name);
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function isHighImpactTool(name: string): boolean {
  return HIGH_IMPACT_TOOLS.has(name);
}

export function defaultPermission(name: string): ToolPermission {
  if (isReadOnlyTool(name)) return "allow";
  if (isSideEffectTool(name)) return "ask";
  return "deny";
}

export function loadPermissions(): Record<string, ToolPermission> {
  try {
    return persistence.getItem<Record<string, ToolPermission>>(PERMISSIONS_KEY) ?? {};
  } catch {
    return {};
  }
}

export function canSavePermission(name: string, perm: ToolPermission): boolean {
  return !(isHighImpactTool(name) && perm === "allow");
}

export function savePermission(name: string, perm: ToolPermission): boolean {
  if (!canSavePermission(name, perm)) return false;
  const next = { ...loadPermissions(), [name]: perm };
  void persistence.setItem(PERMISSIONS_KEY, next);
  return true;
}

export function getPermission(name: string): ToolPermission {
  return loadPermissions()[name] ?? defaultPermission(name);
}

function isExplicitApproval(source: ApprovalSource): boolean {
  return source === "user" || source === "plan" || source === "code";
}

/** Décision unique utilisée par toutes les surfaces IA avant un effet de bord. */
export function authorizeToolCall(
  name: string,
  approvalSource: ApprovalSource = "none",
): ToolAuthorizationDecision {
  const permission = getPermission(name);

  if (!isSideEffectTool(name) && !isReadOnlyTool(name)) {
    return {
      tool: name,
      permission: "deny",
      allowed: false,
      requiresConfirmation: false,
      reason: "Outil non classifié : refusé par défaut.",
    };
  }

  if (permission === "deny") {
    return {
      tool: name,
      permission,
      allowed: false,
      requiresConfirmation: false,
      reason: "Outil refusé par la politique de permissions.",
    };
  }

  if (isHighImpactTool(name)) {
    if (isExplicitApproval(approvalSource)) {
      return {
        tool: name,
        permission,
        allowed: true,
        requiresConfirmation: false,
        reason: "Approbation explicite reçue.",
      };
    }
    return {
      tool: name,
      permission,
      allowed: false,
      requiresConfirmation: true,
      reason: "Une approbation explicite est obligatoire pour cet outil.",
    };
  }

  if (
    permission === "allow" ||
    isExplicitApproval(approvalSource) ||
    approvalSource === "autoApply"
  ) {
    return {
      tool: name,
      permission,
      allowed: true,
      requiresConfirmation: false,
      reason: "Outil autorisé par la politique courante.",
    };
  }

  return {
    tool: name,
    permission,
    allowed: false,
    requiresConfirmation: true,
    reason: "Une confirmation est requise pour cet effet de bord.",
  };
}

// Compatibilité avec les consommateurs locaux qui utilisaient encore le booléen
// `confirmed`; les nouveaux appels doivent utiliser authorizeToolCall.
export type AuthorizationDecision =
  { allowed: true } | { allowed: false; reason: "denied" | "confirmation_required" };

export function authorizeTool(name: string, confirmed: boolean): AuthorizationDecision {
  const decision = authorizeToolCall(name, confirmed ? "user" : "none");
  if (decision.allowed) return { allowed: true };
  return {
    allowed: false,
    reason: decision.requiresConfirmation ? "confirmation_required" : "denied",
  };
}

export function getPermissionToolNames(): string[] {
  return [...SIDE_EFFECT_TOOLS, ...READ_ONLY_TOOLS];
}
