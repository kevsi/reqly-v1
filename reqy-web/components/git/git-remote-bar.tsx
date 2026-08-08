"use client";

import { useState } from "react";
import {
  Globe,
  Plus,
  Trash2,
  Download,
  Upload,
  Cloud,
  GitFork,
  GitBranch,
  FolderOpen,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import { Card } from "@/components/ui/card";
import { isTauriAvailable } from "@/lib/tauri";
import type { RemoteInfo } from "@/hooks/use-git";

interface RemoteBarProps {
  remotes: RemoteInfo[];
  currentBranch: string;
  onAdd: (name: string, url: string) => void;
  onRemove: (name: string) => void;
  onPush: (remote: string, branch: string) => void;
  onForcePush: (remote: string, branch: string) => void;
  onPull: (remote: string, branch: string) => void;
  onFetch: (remote: string) => void;
  onClone: (url: string, destPath: string) => Promise<void>;
  onLsRemote?: (url: string) => Promise<string[]>;
}

export function GitRemoteBar({
  remotes,
  currentBranch,
  onAdd,
  onRemove,
  onPush,
  onForcePush,
  onPull,
  onFetch,
  onClone,
  onLsRemote,
}: RemoteBarProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [forcePushDialog, setForcePushDialog] = useState<{ remote: string; branch: string } | null>(
    null,
  );
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneDest, setCloneDest] = useState("");
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneUrlTouched, setCloneUrlTouched] = useState(false);
  const [cloneDestTouched, setCloneDestTouched] = useState(false);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const pickCloneDest = async () => {
    if (isTauriAvailable()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === "string") {
          setCloneDest(selected);
        }
      } catch {
        // fallback: manual input
      }
    }
  };

  return (
    <Card className="p-2 space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Globe className="size-3" />
          Remotes
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={() => setCloneDialogOpen(true)}
          >
            <GitFork className="size-3" />
            Clone
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="size-3" />
            Add
          </Button>
        </div>
      </div>

      {remotes.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/40 px-1">No remotes configured</p>
      ) : (
        remotes.map((r) => (
          <div
            key={r.name}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
          >
            <Cloud className="size-3 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium">{r.name}</span>
              <span className="text-[10px] text-muted-foreground/60 ml-2 truncate">{r.url}</span>
            </div>
            <div className="flex gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                onClick={() => onFetch(r.name)}
                title="Fetch"
              >
                <Download className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                onClick={() => onPull(r.name, currentBranch)}
                title="Pull"
              >
                <Cloud className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                onClick={() => onPush(r.name, currentBranch)}
                title="Push"
              >
                <Upload className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 text-warning/60 hover:text-warning"
                onClick={() => setForcePushDialog({ remote: r.name, branch: currentBranch })}
                title="Force Push — overwrite remote history"
              >
                <AlertTriangle className="size-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 text-destructive/60"
                onClick={() => onRemove(r.name)}
                title="Remove"
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          </div>
        ))
      )}

      {/* Add remote dialog */}
      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            setRemoteBranches([]);
            setBranchesError(null);
            setBranchesLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Add remote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={remoteName}
              onChange={(e) => setRemoteName(e.target.value)}
              placeholder="origin"
              className="text-sm"
            />
            <div className="flex gap-2">
              <Input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="text-sm flex-1"
              />
              {remoteUrl.trim() && onLsRemote && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setBranchesLoading(true);
                    setBranchesError(null);
                    try {
                      const b = await onLsRemote(remoteUrl.trim());
                      setRemoteBranches(b);
                    } catch (err: unknown) {
                      setBranchesError(err instanceof Error ? err.message : String(err));
                      setRemoteBranches([]);
                    } finally {
                      setBranchesLoading(false);
                    }
                  }}
                  disabled={branchesLoading}
                  className="shrink-0 gap-1 h-9"
                >
                  {branchesLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <GitFork className="size-3" />
                  )}
                  {branchesLoading ? "…" : "⟳"}
                </Button>
              )}
            </div>

            {/* Branch list */}
            {branchesLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Fetching branches…
              </div>
            )}
            {branchesError && (
              <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 border border-destructive/20 px-2.5 py-1.5">
                <AlertCircle className="size-3 text-destructive shrink-0 mt-0.5" />
                <p className="text-[10px] text-destructive leading-relaxed">{branchesError}</p>
              </div>
            )}
            {remoteBranches.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Available branches ({remoteBranches.length})
                </p>
                <div className="max-h-[120px] overflow-y-auto space-y-0.5 rounded-md border border-border/40 bg-muted/20 p-1">
                  {remoteBranches.map((branch) => (
                    <div
                      key={branch}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-foreground font-mono hover:bg-accent/50"
                    >
                      <GitBranch className="size-2.5 text-muted-foreground/60" />
                      {branch}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAddDialogOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onAdd(remoteName, remoteUrl);
                setAddDialogOpen(false);
              }}
              disabled={!remoteName.trim() || !remoteUrl.trim()}
              className="text-xs"
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone dialog */}
      <Dialog
        open={cloneDialogOpen}
        onOpenChange={(open) => {
          if (!open && !cloneLoading) {
            setCloneDialogOpen(false);
            setCloneError(null);
            setCloneUrlTouched(false);
            setCloneDestTouched(false);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Clone repository</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* URL */}
            <div className="space-y-1">
              <Input
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                onBlur={() => setCloneUrlTouched(true)}
                placeholder="https://github.com/user/repo.git"
                className={`text-sm ${cloneUrlTouched && !cloneUrl.trim() ? "border-destructive/50" : ""}`}
              />
              {cloneUrlTouched && !cloneUrl.trim() && (
                <p className="flex items-center gap-1 text-[10px] text-destructive/70">
                  <AlertCircle className="size-2.5" /> Repository URL is required
                </p>
              )}
            </div>
            {/* Destination */}
            <div className="space-y-1">
              <div className="flex gap-2">
                <Input
                  value={cloneDest}
                  onChange={(e) => setCloneDest(e.target.value)}
                  onBlur={() => setCloneDestTouched(true)}
                  placeholder="./my-repo"
                  className={`text-sm flex-1 ${cloneDestTouched && !cloneDest.trim() ? "border-destructive/50" : ""}`}
                  readOnly={isTauriAvailable()}
                />
                {isTauriAvailable() && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={pickCloneDest}
                    className="shrink-0 gap-1"
                  >
                    <FolderOpen className="size-3.5" /> Browse
                  </Button>
                )}
              </div>
              {cloneDestTouched && !cloneDest.trim() && (
                <p className="flex items-center gap-1 text-[10px] text-destructive/70">
                  <AlertCircle className="size-2.5" /> Destination path is required
                </p>
              )}
            </div>

            {/* Error */}
            {cloneError && (
              <div className="flex items-start gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                <AlertCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-[11px] text-destructive leading-relaxed">{cloneError}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCloneDialogOpen(false);
                setCloneError(null);
                setCloneUrlTouched(false);
                setCloneDestTouched(false);
              }}
              disabled={cloneLoading}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                setCloneUrlTouched(true);
                setCloneDestTouched(true);
                if (!cloneUrl.trim() || !cloneDest.trim()) return;
                setCloneLoading(true);
                setCloneError(null);
                try {
                  await onClone(cloneUrl, cloneDest);
                  setCloneDialogOpen(false);
                  setCloneUrlTouched(false);
                  setCloneDestTouched(false);
                } catch (err: unknown) {
                  setCloneError(err instanceof Error ? err.message : String(err));
                } finally {
                  setCloneLoading(false);
                }
              }}
              disabled={!cloneUrl.trim() || !cloneDest.trim() || cloneLoading}
              className="text-xs gap-1.5"
            >
              {cloneLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <GitFork className="size-3" />
              )}
              {cloneLoading ? "Cloning…" : "Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Push confirmation dialog */}
      <Dialog open={!!forcePushDialog} onOpenChange={(open) => !open && setForcePushDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              Force push?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              This will <strong>overwrite remote history</strong> for branch{" "}
              <code className="text-xs bg-muted px-1 rounded">
                {forcePushDialog?.branch ?? "?"}
              </code>{" "}
              on{" "}
              <code className="text-xs bg-muted px-1 rounded">
                {forcePushDialog?.remote ?? "?"}
              </code>
              .
            </p>
            <p className="text-xs text-destructive/80 leading-relaxed">
              Other collaborators will need to rebase their work. This is irreversible—proceed only
              if you're sure.
            </p>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setForcePushDialog(null)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (forcePushDialog) {
                  onForcePush(forcePushDialog.remote, forcePushDialog.branch);
                }
                setForcePushDialog(null);
              }}
              className="text-xs gap-1.5"
            >
              <AlertTriangle className="size-3" />
              Force push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
