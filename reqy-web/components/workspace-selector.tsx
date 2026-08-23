"use client";

import { workspaceFetch } from "@/lib/workspace-api";
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "@/components/ui/text";
import {
  Plus,
  Check,
  Folder,
  Globe,
  Lock,
  Zap,
  Cloud,
  Terminal,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useRequestStore, type Workspace } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";

const workspaceIcons: Record<string, typeof Folder> = {
  folder: Folder,
  globe: Globe,
  lock: Lock,
  zap: Zap,
  cloud: Cloud,
  terminal: Terminal,
};

const workspaceColors: Record<string, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
};

/** True when the workspace is the built-in personal/local workspace */
function isLocalWorkspace(ws: Workspace): boolean {
  return ws.id === WORKSPACE_PERSONAL_ID || !ws.ownerId;
}

export function WorkspaceSelector() {
  const { t } = useTranslation();
  // Atomic selectors — re-render only when the workspaces list or the active
  // workspace id actually changes, not on unrelated mutations.
  const workspaces = useRequestStore((s) => s.workspaces);
  const activeWorkspaceId = useRequestStore((s) => s.activeWorkspaceId);
  // Action refs are stable; group them under one useShallow subscription.
  const {
    addWorkspace,
    addServerWorkspace,
    updateWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
    fetchWorkspacesFromApi,
  } = useRequestStore(
    useShallow((s) => ({
      addWorkspace: s.addWorkspace,
      addServerWorkspace: s.addServerWorkspace,
      updateWorkspace: s.updateWorkspace,
      deleteWorkspace: s.deleteWorkspace,
      setActiveWorkspace: s.setActiveWorkspace,
      fetchWorkspacesFromApi: s.fetchWorkspacesFromApi,
    })),
  );

  // Load workspaces from the sync server on mount and merge into the store
  useEffect(() => {
    fetchWorkspacesFromApi();
  }, [fetchWorkspacesFromApi]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renamingWorkspace, setRenamingWorkspace] = useState<Workspace | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [hoveredWsId, setHoveredWsId] = useState<string | null>(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      const res = await workspaceFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        const serverWs = data.workspace;
        addServerWorkspace({
          id: serverWs.id,
          name: serverWs.name,
          color: "slate",
          icon: "folder",
          description: "",
          createdAt: serverWs.createdAt,
          updatedAt: serverWs.updatedAt,
        });
        setActiveWorkspace(serverWs.id);
      } else {
        // API error, fall back to local-only creation
        addWorkspace({ name: newName.trim(), description: "", color: "slate", icon: "folder" });
      }
    } catch {
      // Network error, fall back to local-only creation
      addWorkspace({ name: newName.trim(), description: "", color: "slate", icon: "folder" });
    }
    setNewName("");
    setCreateOpen(false);
    setCreateLoading(false);
  }, [newName, addWorkspace, addServerWorkspace, setActiveWorkspace]);

  const handleRename = useCallback(async () => {
    if (!renamingWorkspace || !newName.trim()) return;
    setRenameLoading(true);
    const id = renamingWorkspace.id;
    const name = newName.trim();
    // If this is a server workspace with ownerId, try the API first
    if (renamingWorkspace.ownerId) {
      try {
        const res = await workspaceFetch(`/api/workspaces/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (res.ok) {
          await fetchWorkspacesFromApi();
          setRenamingWorkspace(null);
          setNewName("");
          setRenameOpen(false);
          setRenameLoading(false);
          return;
        }
      } catch {
        // API unavailable, fall through to local update
      }
    }
    // Local fallback
    updateWorkspace(id, { name });
    setRenamingWorkspace(null);
    setNewName("");
    setRenameOpen(false);
    setRenameLoading(false);
  }, [renamingWorkspace, newName, updateWorkspace, fetchWorkspacesFromApi]);

  const handleDeleteWorkspace = useCallback(
    async (w: Workspace, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(t("workspace.deleteConfirm", { name: w.name }))) return;

      setDeletingId(w.id);
      if (w.ownerId) {
        // Server workspace — try API first
        try {
          const res = await workspaceFetch(`/api/workspaces/${encodeURIComponent(w.id)}`, {
            method: "DELETE",
          });
          if (res.ok) {
            await fetchWorkspacesFromApi();
            setDeletingId(null);
            return;
          }
        } catch {
          // API unavailable, fall through to local delete
        }
      }
      deleteWorkspace(w.id);
      setDeletingId(null);
    },
    [deleteWorkspace, fetchWorkspacesFromApi, t],
  );

  const openRename = useCallback((w: Workspace) => {
    setRenamingWorkspace(w);
    setNewName(w.name);
    setRenameOpen(true);
  }, []);

  const IconComponent = activeWorkspace ? workspaceIcons[activeWorkspace.icon] || Folder : Folder;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t("workspace.selectAria", {
              name: activeWorkspace?.name ?? t("workspace.workspace"),
            })}
            title={activeWorkspace?.name ?? t("workspace.workspace")}
            className="group/ws flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-foreground transition-all duration-200 hover:border-border hover:bg-accent/50"
          >
            <div
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md",
                activeWorkspace
                  ? workspaceColors[activeWorkspace.color] || "bg-slate-500"
                  : "bg-slate-500",
              )}
            >
              <IconComponent className="size-3.5 text-white" />
            </div>
            <span className="max-w-[140px] truncate @max-[26rem]:hidden">
              {activeWorkspace?.name ?? t("workspace.workspace")}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[240px] animate-scale-in">
          <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Text variant="label">{t("workspace.workspaces")}</Text>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.map((w) => {
            const Icon = workspaceIcons[w.icon] || Folder;
            const isActive = w.id === activeWorkspaceId;
            return (
              <DropdownMenuItem
                key={w.id}
                onClick={() => setActiveWorkspace(w.id)}
                onMouseEnter={() => setHoveredWsId(w.id)}
                onMouseLeave={() => setHoveredWsId(null)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  isActive && "bg-primary/10 text-primary",
                )}
              >
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    workspaceColors[w.color] || "bg-slate-500",
                  )}
                >
                  <Icon className="size-3.5 text-white" />
                </div>
                <span className="flex-1 truncate text-sm">{w.name}</span>
                {isActive && <Check className="size-4 shrink-0 text-primary" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openRename(w);
                  }}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                    hoveredWsId === w.id ? "opacity-100" : "opacity-0",
                  )}
                  aria-label={`${t("workspace.renameTooltip")} ${w.name}`}
                  title={t("workspace.renameTooltip")}
                >
                  <Pencil className="size-3.5" />
                </button>
                {isLocalWorkspace(w) ? null : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteWorkspace(w, e);
                    }}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-destructive",
                      hoveredWsId === w.id || deletingId === w.id ? "opacity-100" : "opacity-0",
                    )}
                    disabled={deletingId === w.id}
                    aria-label={`${t("workspace.deleteTooltip")} ${w.name}`}
                    title={t("workspace.deleteTooltip")}
                  >
                    {deletingId === w.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
              <Plus className="size-3.5" />
            </div>
            <span>{t("workspace.newWorkspace")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("workspace.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ws-name">{t("workspace.nameLabel")}</Label>
              <Input
                id="ws-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("workspace.namePlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createLoading}>
              {createLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {t("workspace.creating")}
                </span>
              ) : (
                t("workspace.create")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(v) => {
          setRenameOpen(v);
          if (!v) setRenamingWorkspace(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("workspace.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ws-rename">{t("workspace.nameLabel")}</Label>
              <Input
                id="ws-rename"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameOpen(false);
                setRenamingWorkspace(null);
              }}
              disabled={renameLoading}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim() || renameLoading}>
              {renameLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {t("workspace.renaming")}
                </span>
              ) : (
                t("workspace.rename")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
