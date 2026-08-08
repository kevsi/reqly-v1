import type { Workspace } from "@/hooks/request-types";
import { CommitFn } from "./types";

export function createWorkspacesMutations(commit: CommitFn) {
  const addWorkspace = (data: Omit<Workspace, "id" | "createdAt" | "updatedAt">) => {
    const now = Date.now();
    const workspace: Workspace = {
      ...data,
      id: `ws-${now}`,
      createdAt: now,
      updatedAt: now,
    };
    commit((prev) => ({
      ...prev,
      workspaces: [...prev.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    }));
    return workspace.id;
  };

  const updateWorkspace = (id: string, updates: Partial<Workspace>) => {
    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((w) =>
        w.id === id ? { ...w, ...updates, updatedAt: Date.now() } : w,
      ),
    }));
  };

  const deleteWorkspace = (id: string) => {
    commit((prev) => {
      const remaining = prev.workspaces.filter((w) => w.id !== id);
      if (remaining.length === 0) return prev;
      return {
        ...prev,
        workspaces: remaining,
        activeWorkspaceId: prev.activeWorkspaceId === id ? remaining[0].id : prev.activeWorkspaceId,
      };
    });
  };

  const setActiveWorkspace = (id: string) => {
    commit((prev) => ({ ...prev, activeWorkspaceId: id }));
  };

  /** Add a workspace that was already created on the server (with a server-assigned ID) */
  const addServerWorkspace = (workspace: Workspace) => {
    commit((prev) => ({
      ...prev,
      workspaces: [...prev.workspaces, workspace],
    }));
    return workspace.id;
  };

  return {
    addWorkspace,
    addServerWorkspace,
    updateWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
  };
}
