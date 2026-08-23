"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Trash2,
  Copy,
  Users,
  UserPlus,
  AlertCircle,
  Shield,
  Building2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useRequestStore, type Workspace } from "@/hooks/use-request-store";
import { workspaceFetch } from "@/lib/workspace-api";
import { SyncSignedOutBanner } from "@/components/sync-signed-out-banner";
import { useSessionStore } from "@/lib/session-store";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";

interface MemberData {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: number;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** True when the workspace is the built-in personal/local workspace — those
 *  cannot be shared, have no members, and cannot be deleted. */
function isLocalWorkspace(ws: Workspace): boolean {
  return ws.id === WORKSPACE_PERSONAL_ID || !ws.ownerId;
}

export default function WorkspacesPage() {
  const { t } = useTranslation();
  const workspaces = useRequestStore((s) => s.workspaces);
  const fetchWorkspacesFromApi = useRequestStore((s) => s.fetchWorkspacesFromApi);
  const router = useRouter();
  const isAuthenticated = useSessionStore((s) => s.status === "authenticated");

  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [invitation, setInvitation] = useState<{ token: string; expiresAt: number } | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");

  // Load workspaces from the sync server and populate the shared store
  useEffect(() => {
    fetchWorkspacesFromApi().finally(() => setLoading(false));
  }, [fetchWorkspacesFromApi]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) return;
    setCreating(true);
    try {
      const res = await workspaceFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      if (!res.ok) throw new Error("create failed");
      // Refresh the store so header & page are in sync
      await fetchWorkspacesFromApi();
      setWorkspaceName("");
      setCreateOpen(false);
      toast({ title: "Workspace created" });
    } catch {
      toast({ title: "Failed to create workspace", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      const res = await workspaceFetch(`/api/workspaces/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      await fetchWorkspacesFromApi();
      setDeleteOpen(false);
      setSelected(null);
      toast({ title: "Workspace deleted" });
    } catch {
      toast({ title: "Failed to delete workspace", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const openMembers = async (ws: Workspace) => {
    if (isLocalWorkspace(ws)) return;
    setSelected(ws);
    setMembers([]);
    setMembersLoading(true);
    setMembersOpen(true);
    try {
      const res = await workspaceFetch(`/api/workspaces/${encodeURIComponent(ws.id)}/members`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch {
      toast({ title: "Failed to load members", variant: "destructive" });
    } finally {
      setMembersLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!selected) return;
    try {
      const res = await workspaceFetch(
        `/api/workspaces/${encodeURIComponent(selected.id)}/members/${encodeURIComponent(memberId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "remove failed");
      }
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      toast({ title: "Member removed" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to remove member",
        variant: "destructive",
      });
    }
  };

  const handleChangeRole = async (memberId: string, newRole: "editor" | "viewer") => {
    if (!selected) return;
    try {
      const res = await workspaceFetch(
        `/api/workspaces/${encodeURIComponent(selected.id)}/members/${encodeURIComponent(memberId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "role change failed");
      }
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
      toast({ title: `Role changed to ${newRole}` });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to change role",
        variant: "destructive",
      });
    }
  };

  const openInvite = (ws: Workspace) => {
    if (isLocalWorkspace(ws)) return;
    setSelected(ws);
    setInvitation(null);
    setInviteRole("editor");
    setInviteOpen(true);
  };

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setInviting(true);
    try {
      const res = await workspaceFetch(
        `/api/workspaces/${encodeURIComponent(selected.id)}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: inviteRole }),
        },
      );
      if (!res.ok) throw new Error("invite failed");
      const data = await res.json();
      setInvitation(data);
      toast({ title: "Invitation created" });
    } catch {
      toast({ title: "Failed to create invitation", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const inviteUrl = invitation
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "")}/join?token=${invitation.token}`
    : "";

  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="flex flex-col gap-4 border-b border-border bg-background/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Organize your team, share collections, and manage access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="join-workspace-button"
            variant="outline"
            onClick={() => setJoinOpen(true)}
          >
            <UserPlus className="mr-2 size-4" />
            Join Workspace
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            New Workspace
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {!isAuthenticated && <SyncSignedOutBanner />}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            Loading workspaces...
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-muted">
              <Building2 className="size-10 text-muted-foreground/40" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">No workspaces yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a workspace to start sharing collections and collaborating with your team.
            </p>
            <Button className="mt-6" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              Create your first workspace
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws) => (
              <Card key={ws.id} className="bg-card">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Building2 className="size-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
                          {ws.name}
                          {isLocalWorkspace(ws) && (
                            <span
                              className="text-muted-foreground/60"
                              title={t("workspace.localTooltip")}
                            >
                              🔒
                            </span>
                          )}
                        </CardTitle>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            ws.role === "owner"
                              ? "bg-success/10 text-success"
                              : ws.role
                                ? "bg-warning/10 text-warning"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {ws.role === "owner" ? (
                            <>
                              <Shield className="size-3" /> Owner
                            </>
                          ) : ws.role ? (
                            ws.role
                          ) : (
                            "Local"
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Created {formatDate(ws.createdAt)}</span>
                    <span>Updated {timeAgo(ws.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!isLocalWorkspace(ws) && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-blue-200/40 text-blue-700 transition-all duration-150 hover:scale-105 hover:bg-blue-50 hover:text-blue-800 hover:shadow-sm active:scale-95 dark:border-blue-800/30 dark:text-blue-400 dark:hover:bg-blue-950/50"
                          onClick={() => openMembers(ws)}
                        >
                          <Users className="mr-1.5 size-3.5" />
                          Members
                        </Button>
                        {ws.role === "owner" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 border-emerald-200/40 text-emerald-700 transition-all duration-150 hover:scale-105 hover:bg-emerald-50 hover:text-emerald-800 hover:shadow-sm active:scale-95 dark:border-emerald-800/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                            onClick={() => openInvite(ws)}
                          >
                            <UserPlus className="mr-1.5 size-3.5" />
                            Invite
                          </Button>
                        )}
                        {ws.role === "owner" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-200/40 text-red-500 transition-all duration-150 hover:scale-105 hover:bg-red-50 hover:text-red-700 hover:shadow-sm active:scale-95 dark:border-red-800/30 dark:text-red-400 dark:hover:bg-red-950/50"
                            onClick={() => {
                              setSelected(ws);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Workspace Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/10">
                <Plus className="size-4 text-primary" />
              </div>
              New Workspace
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <Input
              placeholder="Workspace name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              autoFocus
              maxLength={100}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!workspaceName.trim() || creating}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Members Dialog */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              {selected?.name} — Members
            </DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-border max-h-[60vh] overflow-auto">
            {membersLoading ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading members…</p>
              </div>
            ) : members.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No members found.</p>
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4 px-1 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected?.role === "owner" && m.role !== "owner" ? (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          handleChangeRole(m.id, e.target.value as "editor" | "viewer")
                        }
                        className="rounded border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          m.role === "owner"
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning",
                        )}
                      >
                        {m.role}
                      </span>
                    )}
                    {selected?.role === "owner" && m.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveMember(m.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Invitation Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/10">
                <UserPlus className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              Invite to {selected?.name}
            </DialogTitle>
          </DialogHeader>
          {!invitation ? (
            <form onSubmit={handleCreateInvitation} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate an invitation link. The member joins with the role chosen below.
              </p>
              <div className="space-y-2">
                <label htmlFor="invite-role" className="text-sm font-medium">
                  Role
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
                  className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="editor">Editor — peut créer et modifier</option>
                  <option value="viewer">Viewer — lecture seule</option>
                </select>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting}>
                  {inviting ? "Generating..." : "Generate Invitation"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">Invitation link</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all text-xs text-foreground">{inviteUrl}</code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteUrl);
                      toast({ title: "Link copied to clipboard" });
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="size-3.5" />
                Expires on {formatDate(invitation.expiresAt)}
              </p>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setInvitation(null);
                    setInviteOpen(false);
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Join Workspace Dialog */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/10">
                <UserPlus className="size-4 text-primary" />
              </div>
              Join a workspace
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Paste the invitation link or token provided by the workspace administrator.
          </p>
          <Input
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            placeholder="https://.../join?token=abc or token"
            className="h-9"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setJoinOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!joinInput.trim() || joining}
              onClick={() => {
                setJoining(true);
                const raw = joinInput.trim();
                let token = raw;
                try {
                  if (raw.includes("token=")) {
                    const url = new URL(
                      raw.includes("://") ? raw : `https://x/?${raw.split("?")[1] ?? ""}`,
                    );
                    token = url.searchParams.get("token") || raw;
                  }
                } catch {
                  token = raw;
                }
                setJoinOpen(false);
                setJoinInput("");
                router.push(`/join?token=${encodeURIComponent(token)}`);
              }}
            >
              {joining ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Redirection…
                </span>
              ) : (
                "Continue"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-red-500/10">
                <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
              </div>
              Delete Workspace
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-red-200/30 bg-red-50/30 p-3 text-sm dark:border-red-900/30 dark:bg-red-950/20">
            <p className="text-foreground">
              Are you sure you want to delete <strong>{selected?.name}</strong>? This will remove
              all members, invitations, and data associated with this workspace. This action cannot
              be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
