import type { Workspace } from "@/hooks/request-types";
import { requestStore } from "@/hooks/use-request-store";
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

  const duplicateWorkspace = (id: string) => {
    const store = requestStore.getState();
    const source = store.workspaces.find((w) => w.id === id);
    if (!source) return null;

    const now = Date.now();
    const newId = `ws-${now}`;
    const newName = `${source.name} (Copy)`;

    const wsCols = store.collections.filter((c) => c.workspaceId === id);
    const idMap = new Map<string, string>();
    const newCols = wsCols.map((col) => {
      const colId = `col-${crypto.randomUUID()}`;
      idMap.set(col.id, colId);
      return {
        ...col,
        id: colId,
        name: col.name,
        workspaceId: newId,
        createdAt: now,
        updatedAt: now,
        requests: col.requests.map((r) => ({
          ...r,
          id: `req-${crypto.randomUUID()}`,
          collectionId: colId,
          createdAt: now,
          updatedAt: now,
        })),
        folders: col.folders?.map((f) => ({
          ...f,
          id: `folder-${crypto.randomUUID()}`,
          collectionId: colId,
          createdAt: now,
          updatedAt: now,
        })),
      };
    });

    const newEnvs = store.environments
      .filter((e) => e.workspaceId === id)
      .map((e) => ({
        ...e,
        id: `env-${crypto.randomUUID()}`,
        workspaceId: newId,
        createdAt: now,
        updatedAt: now,
      }));

    const newWorkspace: Workspace = {
      ...source,
      id: newId,
      name: newName,
      createdAt: now,
      updatedAt: now,
    };

    commit((prev) => ({
      ...prev,
      workspaces: [...prev.workspaces, newWorkspace],
      collections: [...prev.collections, ...newCols],
      environments: [...prev.environments, ...newEnvs],
    }));

    return newId;
  };

  const archiveWorkspace = (id: string) => {
    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((w) =>
        w.id === id ? { ...w, archived: true, updatedAt: Date.now() } : w,
      ),
    }));
  };

  const unarchiveWorkspace = (id: string) => {
    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((w) =>
        w.id === id ? { ...w, archived: false, updatedAt: Date.now() } : w,
      ),
    }));
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
    duplicateWorkspace,
    archiveWorkspace,
    unarchiveWorkspace,
  };
}
