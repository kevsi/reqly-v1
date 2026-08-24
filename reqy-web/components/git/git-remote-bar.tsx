"use client";

import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  CheckCircle2,
  Loader2,
  RefreshCw,
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
import { useToolConnections } from "@/hooks/use-tool-connections";
import type { RemoteInfo } from "@/hooks/use-git";
import type { GitCredentials } from "@/lib/git/types";
import { FolderPickerModal } from "@/components/folder-picker-modal";
import type { PickedFolder } from "@/lib/folder-picker";

interface RemoteBarProps {
  remotes: RemoteInfo[];
  currentBranch: string;
  onAdd: (name: string, url: string) => void;
  onRemove: (name: string) => Promise<void>;
  onPush: (remote: string, branch: string, credentials?: GitCredentials) => Promise<void>;
  onForcePush: (remote: string, branch: string, credentials?: GitCredentials) => Promise<void>;
  onPull: (remote: string, branch: string, credentials?: GitCredentials) => Promise<void>;
  onFetch: (remote: string, credentials?: GitCredentials) => Promise<void>;
  onClone: (url: string, destPath: string, credentials?: GitCredentials) => Promise<void>;
  onLsRemote?: (url: string) => Promise<string[]>;
  /** Web uniquement : fournit le handle de destination au backend (clone). */
  onSetRepoHandle?: (handle: FileSystemDirectoryHandle) => void;
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
  onSetRepoHandle,
}: RemoteBarProps) {
  const { t } = useTranslation();
  const githubConnected = useToolConnections((s) => s.github === "connected");
  const gitlabConnected = useToolConnections((s) => s.gitlab === "connected");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [folderPickerModalOpen, setFolderPickerModalOpen] = useState(false);
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
  const [cloneUsername, setCloneUsername] = useState("");
  const [clonePassword, setClonePassword] = useState("");
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  // Sur le web, on conserve le handle du dossier sélectionné (permission réutilisable).
  const cloneDestHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  // ── Feedback par opération (push / fetch / pull / remove) ──────────────
  type OpState = { status: "loading" | "success" | "error"; message?: string };
  const [ops, setOps] = useState<Record<string, OpState>>({});

  const setOp = (key: string, state: OpState) => setOps((prev) => ({ ...prev, [key]: state }));

  const runOp = async (key: string, fn: () => Promise<void>) => {
    setOp(key, { status: "loading" });
    try {
      await fn();
      setOp(key, { status: "success" });
      window.setTimeout(() => {
        setOps((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
    } catch (err) {
      setOp(key, {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      window.setTimeout(() => {
        setOps((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 6000);
    }
  };

  const opFor = (key: string): OpState | undefined => ops[key];

  const pickCloneDest = () => {
    setFolderPickerModalOpen(true);
  };

  const handleCloneFolderSelected = (picked: PickedFolder) => {
    setCloneDest(picked.path ?? picked.name);
    if (picked.handle) {
      cloneDestHandleRef.current = picked.handle;
      onSetRepoHandle?.(picked.handle);
    }
  };

  return (
    <Card className="p-2 space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Globe className="size-3" />
          {t("git.remotes")}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={() => setCloneDialogOpen(true)}
          >
            <GitFork className="size-3" />
            {t("git.remoteClone")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="size-3" />
            {t("git.remoteAdd")}
          </Button>
        </div>
      </div>

      {remotes.length === 0 ? (
        <div className="flex items-center justify-between px-1 py-0.5">
          <p className="text-[10px] text-muted-foreground/60 truncate">{t("git.remoteNoRemote")}</p>
          <Button
            variant="link"
            size="sm"
            className="h-5 px-1 text-[10px] text-primary hover:underline gap-0.5"
            onClick={() => setAddDialogOpen(true)}
          >
            {t("git.remoteAddShort")}
          </Button>
        </div>
      ) : (
        remotes.map((r) => {
          const host = new URL(r.url).hostname.toLowerCase();
          const autoAuth =
            (githubConnected && (host === "github.com" || host.endsWith(".github.com"))) ||
            (gitlabConnected && (host === "gitlab.com" || host.endsWith(".gitlab.com")));
          const fetchOp = opFor(`fetch:${r.name}`);
          const pullOp = opFor(`pull:${r.name}`);
          const pushOp = opFor(`push:${r.name}`);
          const removeOp = opFor(`remove:${r.name}`);
          const activeOp = fetchOp ?? pullOp ?? pushOp ?? removeOp;
          return (
            <div
              key={r.name}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
            >
              <Cloud className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{r.name}</span>
                  {autoAuth && (
                    <span className="inline-flex items-center rounded-full bg-success/10 px-1.5 py-0.5 text-[9px] font-medium text-success/80">
                      {t("git.remoteConnected")}
                    </span>
                  )}
                  {activeOp?.status === "loading" && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Loader2 className="size-2.5 animate-spin" /> {t("git.remoteInProgress")}
                    </span>
                  )}
                  {activeOp?.status === "success" && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-success">
                      <CheckCircle2 className="size-2.5" /> OK
                    </span>
                  )}
                  {activeOp?.status === "error" && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-destructive">
                      <AlertCircle className="size-2.5" /> Échec
                    </span>
                  )}
                </div>
                <span className="block text-[10px] text-muted-foreground/60 truncate">{r.url}</span>
                {activeOp?.status === "error" && activeOp.message && (
                  <p className="mt-1 rounded border border-destructive/20 bg-destructive/10 px-1.5 py-1 text-[10px] leading-tight break-words text-destructive">
                    {activeOp.message}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => runOp(`fetch:${r.name}`, () => onFetch(r.name))}
                  title={t("git.fetch")}
                  disabled={fetchOp?.status === "loading"}
                >
                  {fetchOp?.status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : fetchOp?.status === "success" ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : fetchOp?.status === "error" ? (
                    <AlertCircle className="size-4 text-destructive" />
                  ) : (
                    <Download className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => runOp(`pull:${r.name}`, () => onPull(r.name, currentBranch))}
                  title={t("git.pull")}
                  disabled={pullOp?.status === "loading"}
                >
                  {pullOp?.status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : pullOp?.status === "success" ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : pullOp?.status === "error" ? (
                    <AlertCircle className="size-4 text-destructive" />
                  ) : (
                    <Cloud className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => runOp(`push:${r.name}`, () => onPush(r.name, currentBranch))}
                  title={t("git.push")}
                  disabled={pushOp?.status === "loading"}
                >
                  {pushOp?.status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : pushOp?.status === "success" ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : pushOp?.status === "error" ? (
                    <AlertCircle className="size-4 text-destructive" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 text-warning/60 hover:text-warning"
                  onClick={() => setForcePushDialog({ remote: r.name, branch: currentBranch })}
                  title={t("git.forcePushTooltip")}
                >
                  <AlertTriangle className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 text-destructive/60"
                  onClick={() => runOp(`remove:${r.name}`, () => onRemove(r.name))}
                  title={t("git.remove")}
                  disabled={removeOp?.status === "loading"}
                >
                  {removeOp?.status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : removeOp?.status === "error" ? (
                    <AlertCircle className="size-4 text-destructive" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          );
        })
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
            <DialogTitle className="text-sm">{t("git.remoteAddDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={remoteName}
              onChange={(e) => setRemoteName(e.target.value)}
              placeholder={t("git.remoteNamePlaceholder")}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder={t("git.remoteUrlPlaceholder")}
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
                  {branchesLoading ? "…" : <RefreshCw aria-hidden="true" className="size-3" />}
                </Button>
              )}
            </div>

            {/* Branch list */}
            {branchesLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {t("git.remoteFetchingBranches")}
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
                  {t("git.remoteAvailableBranches", { count: remoteBranches.length })}
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
              {t("common.cancel")}
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
              {t("git.remoteAdd")}
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
            <DialogTitle className="text-sm">{t("git.remoteCloneTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* URL */}
            <div className="space-y-1">
              <Input
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                onBlur={() => setCloneUrlTouched(true)}
                placeholder={t("git.remoteUrlPlaceholder")}
                className={`text-sm ${cloneUrlTouched && !cloneUrl.trim() ? "border-destructive/50" : ""}`}
              />
              {cloneUrlTouched && !cloneUrl.trim() && (
                <p className="flex items-center gap-1 text-[10px] text-destructive/70">
                  <AlertCircle className="size-2.5" /> {t("git.remoteCloneUrlRequired")}
                </p>
              )}
            </div>
            <details className="rounded-md border border-border/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {t("git.remoteCloneAuth")}
              </summary>
              <div className="mt-2 space-y-2">
                <Input
                  value={cloneUsername}
                  onChange={(e) => setCloneUsername(e.target.value)}
                  placeholder={t("git.remoteCloneUsername")}
                  autoComplete="username"
                />
                <Input
                  type="password"
                  value={clonePassword}
                  onChange={(e) => setClonePassword(e.target.value)}
                  placeholder={t("git.remoteClonePassword")}
                  autoComplete="current-password"
                />
              </div>
            </details>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={pickCloneDest}
                  className="shrink-0 gap-1"
                >
                  <FolderOpen className="size-3.5" /> {t("git.browse")}
                </Button>
              </div>
              {cloneDestTouched && !cloneDest.trim() && (
                <p className="flex items-center gap-1 text-[10px] text-destructive/70">
                  <AlertCircle className="size-2.5" /> {t("git.remoteCloneDestRequired")}
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
              {t("common.cancel")}
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
                  await onClone(
                    cloneUrl,
                    cloneDest,
                    cloneUsername && clonePassword
                      ? { username: cloneUsername, password: clonePassword }
                      : undefined,
                  );
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
              {cloneLoading ? t("git.remoteCloning") : t("git.remoteClone")}
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
              {t("git.forcePushTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <Trans
                i18nKey="git.forcePushDesc"
                t={t}
                values={{
                  branch: forcePushDialog?.branch ?? "?",
                  remote: forcePushDialog?.remote ?? "?",
                }}
                components={[
                  <strong key="strong" />,
                  <code key="code-branch" className="text-xs bg-muted px-1 rounded" />,
                  <code key="code-remote" className="text-xs bg-muted px-1 rounded" />,
                ]}
              />
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
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (forcePushDialog) {
                  const { remote, branch } = forcePushDialog;
                  setForcePushDialog(null);
                  runOp(`push:${remote}`, () => onForcePush(remote, branch));
                }
              }}
              className="text-xs gap-1.5"
            >
              <AlertTriangle className="size-3" />
              {t("git.remoteForcePush")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Picker Modal */}
      <FolderPickerModal
        open={folderPickerModalOpen}
        onClose={() => setFolderPickerModalOpen(false)}
        onSelect={handleCloneFolderSelected}
      />
    </Card>
  );
}
