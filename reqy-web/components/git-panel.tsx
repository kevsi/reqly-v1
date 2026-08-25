"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  GitCommit,
  GitCommitHorizontal,
  AlertCircle,
  Diff,
  CheckCircle2,
  FolderOpen,
  Loader2,
  ChevronDown,
  Archive,
  CornerUpLeft,
  Check,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FolderPickerModal } from "@/components/folder-picker-modal";
import type { PickedFolder } from "@/lib/folder-picker";

import { isTauriAvailable } from "@/lib/tauri";
import { useGit, type GitCommit as GitCommitType, type DiffFile } from "@/hooks/use-git";
import { GitStatusRow } from "@/components/git/git-status-row";
import { GitBranchBar } from "@/components/git/git-branch-bar";
import { GitRemoteBar } from "@/components/git/git-remote-bar";
import { GitDiffViewer } from "@/components/git/git-diff-viewer";
import { GitConflictResolver } from "@/components/git/git-conflict-resolver";

import type { Collection } from "@/hooks/use-request-store";

// Identité de commit persistée localement (préremplissage uniquement —
// l'utilisateur peut toujours la modifier avant chaque commit).
const GIT_AUTHOR_KEY = "reqly.git.author";

function readGitAuthor(): { name: string; email: string } {
  // SSR-safe : pas de localStorage pendant le prerender serveur.
  if (typeof window === "undefined") return { name: "", email: "" };
  try {
    const raw = window.localStorage.getItem(GIT_AUTHOR_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { name?: string; email?: string };
      return { name: saved.name ?? "", email: saved.email ?? "" };
    }
  } catch {
    // stockage indisponible ou JSON invalide
  }
  return { name: "", email: "" };
}

function emailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface GitPanelProps {
  collections: Collection[];
}

export function GitPanel({ collections }: GitPanelProps) {
  const { t } = useTranslation();
  const git = useGit(collections);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitAuthorName, setCommitAuthorName] = useState(() => readGitAuthor().name);
  const [commitAuthorEmail, setCommitAuthorEmail] = useState(() => readGitAuthor().email);
  const [stashDialogOpen, setStashDialogOpen] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [stashLoading, setStashLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [openLoading, setOpenLoading] = useState(false);
  const [_diffOids, setDiffOids] = useState<[string, string] | null>(null);
  const [diffResult, setDiffResult] = useState<DiffFile[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("history");
  const [repoPathInput, setRepoPathInput] = useState("");
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);

  const pickRepoFolder = async () => {
    if (isTauriAvailable()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === "string") {
          setRepoPathInput(selected);
        }
      } catch {
        // fallback: manual input
      }
    }
  };

  const handleRepoFolderSelected = (picked: PickedFolder) => {
    setRepoPathInput(picked.path ?? picked.name);
    if (picked.handle) git.setRepoHandle(picked.handle);
  };

  const handleCommit = async () => {
    const authorName = commitAuthorName.trim();
    const authorEmail = commitAuthorEmail.trim();
    // Identité OBLIGATOIRE : un commit poussé en "Reqly User <user@reqly.local>"
    // est irrécupérable une fois sur le distant.
    if (!commitMessage.trim() || !authorName || !emailValid(authorEmail)) return;
    setCommitLoading(true);
    try {
      await git.commit(commitMessage.trim(), authorName, authorEmail);
      try {
        localStorage.setItem(
          GIT_AUTHOR_KEY,
          JSON.stringify({ name: authorName, email: authorEmail }),
        );
      } catch {
        // stockage indisponible : l'identité ne sera juste pas préremplie
      }
      setCommitMessage("");
      setCommitAuthorName("");
      setCommitAuthorEmail("");
      setCommitDialogOpen(false);
    } finally {
      setCommitLoading(false);
    }
  };

  const handleStashSave = async () => {
    setStashLoading(true);
    try {
      await git.stashSave(stashMessage.trim() || undefined);
      setStashMessage("");
      setStashDialogOpen(false);
    } finally {
      setStashLoading(false);
    }
  };

  const collectionNameForPath = (filepath: string): string | null => {
    const match = filepath.match(/collections\/.+_(.+)\.json$/);
    if (!match) return null;
    const id = match[1];
    const col = collections.find((c) => c.id === id);
    return col ? col.name : null;
  };

  const handleDiff = async (oidA: string, oidB: string) => {
    setDiffLoading(true);
    setDiffOids([oidA, oidB]);
    try {
      const result = await git.diff(oidA, oidB);
      setDiffResult(result);
    } catch {
      setDiffResult(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleFileDiff = async (filepath: string) => {
    if (git.commits.length === 0) return;
    const head = git.commits[0].oid;
    setDiffLoading(true);
    setDiffOids([head, "WORKING"]);
    setActiveTab("diff");
    try {
      const result = await git.diff(head, "WORKING");
      const fileDiff = result.filter((f) => f.filepath === filepath);
      setDiffResult(fileDiff.length > 0 ? fileDiff : result);
    } catch {
      setDiffResult(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const statusFiles = git.status.filter((s) => s.workdir !== 1 || s.head !== 1);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <GitBranch className="size-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight leading-none">
              Git
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {git.isInitialized ? (
                <GitBranchBar
                  branches={git.branches}
                  currentBranch={git.currentBranch}
                  onSwitch={git.branchSwitch}
                  onCreate={git.branchCreate}
                  onDelete={git.branchDelete}
                />
              ) : (
                <p className="text-[10px] text-muted-foreground/40">{t("git.notInitialized")}</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {git.isInitialized && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs font-medium"
                    title={t("git.stash")}
                  >
                    <Archive className="size-3.5" />
                    {t("git.stash")}
                    {git.stashes.length > 0 && (
                      <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px]">
                        {git.stashes.length}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem
                    onClick={() => setStashDialogOpen(true)}
                    className="text-xs gap-2"
                  >
                    <Archive className="size-3.5" />
                    {t("git.stashSaveAction")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {git.stashes.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">
                      {t("git.stashEmpty")}
                    </p>
                  ) : (
                    git.stashes.map((s) => (
                      <div
                        key={s.oid}
                        className="flex items-center gap-1 px-2 py-1.5 hover:bg-accent/50 rounded-md mx-1"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground truncate">{s.message}</p>
                          <p className="text-[10px] text-muted-foreground/50">
                            {s.oid.slice(0, 7)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-6 p-0"
                          onClick={() => git.stashApply(s.index)}
                          title={t("git.stashApply")}
                        >
                          <CornerUpLeft className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-6 p-0"
                          onClick={() => git.stashPop(s.index)}
                          title={t("git.stashPop")}
                        >
                          <Check className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-6 p-0 text-destructive/60"
                          onClick={() => git.stashDrop(s.index)}
                          title={t("git.stashDrop")}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                onClick={() => setCommitDialogOpen(true)}
                className="h-7 gap-1.5 text-xs font-medium"
              >
                <GitCommit className="size-3.5" />
                {t("git.commit")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {git.error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>{git.error}</span>
        </div>
      )}

      <div className="px-4 py-1 shrink-0">
        <GitRemoteBar
          remotes={git.remotes}
          currentBranch={git.currentBranch || "main"}
          onAdd={git.remoteAdd}
          onRemove={git.remoteRemove}
          onPush={git.push}
          onForcePush={git.forcePush}
          onPull={git.pull}
          onFetch={git.fetch}
          onClone={git.clone}
          onLsRemote={git.lsRemote}
          onSetRepoHandle={git.setRepoHandle}
        />
      </div>

      {/* Main content */}
      {git.isInitialized ? (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="mx-4 mt-3 mb-2 h-7 w-auto self-start rounded-lg border border-border/40 bg-muted/30 p-0.5">
            <TabsTrigger
              value="history"
              className="h-6 px-3 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-xs"
            >
              {t("git.history")}
            </TabsTrigger>
            <TabsTrigger
              value="status"
              className="h-6 px-3 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-xs"
            >
              {t("git.status")}
              {statusFiles.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 px-1 text-[9px]">
                  {statusFiles.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="diff"
              className="h-6 px-3 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-xs"
            >
              {t("git.diff")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="flex-1 min-h-0 m-0 px-4 pb-4">
            <ScrollArea className="h-full pr-2">
              <div className="space-y-1">
                {git.commits.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="rounded-2xl bg-muted/20 p-5 mb-3 ring-1 ring-border/40">
                      <GitCommitHorizontal className="size-8 text-muted-foreground/20" />
                    </div>
                    <p className="text-sm font-medium text-foreground/80">
                      {t("git.noCommitsTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {t("git.noCommitsDescription")}
                    </p>
                  </div>
                ) : (
                  git.commits.map((c) => (
                    <CommitRow key={c.oid} commit={c} onDiff={(oid) => handleDiff(oid, c.oid)} />
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="status" className="flex-1 min-h-0 m-0 px-4 pb-4">
            <ScrollArea className="h-full pr-2">
              <div className="space-y-1">
                {git.conflicts.length > 0 && (
                  <GitConflictResolver conflicts={git.conflicts} onStage={git.stage} />
                )}
                {statusFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <CheckCircle2 className="size-8 text-success/40 mb-3" />
                    <p className="text-sm font-medium text-foreground/80">{t("git.cleanTitle")}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {t("git.cleanDescription")}
                    </p>
                  </div>
                ) : (
                  <>
                    {statusFiles.length > 0 && (
                      <div className="flex items-center justify-between px-1 mb-2">
                        <span className="text-xs text-muted-foreground">
                          {t("git.filesChanged", { count: statusFiles.length })}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs gap-1"
                          onClick={() => git.stageAll()}
                        >
                          {t("git.stageAll")}
                        </Button>
                      </div>
                    )}
                    {statusFiles.map((s) => (
                      <GitStatusRow
                        key={s.filepath}
                        status={s}
                        onStage={git.stage}
                        onUnstage={git.unstage}
                        onView={handleFileDiff}
                        displayName={collectionNameForPath(s.filepath)}
                      />
                    ))}
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="diff" className="flex-1 min-h-0 m-0 px-4 pb-4">
            <ScrollArea className="h-full pr-2">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <select
                      className="h-7 w-full appearance-none rounded-md border border-border bg-muted/30 px-2 pr-7 text-xs transition-colors hover:border-muted-foreground/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
                      onChange={(e) => {
                        const [a, b] = e.target.value.split("..");
                        if (a && b) handleDiff(a, b);
                      }}
                    >
                      <option value="">{t("git.selectCommits")}</option>
                      {git.commits.map((c, i) =>
                        git.commits.slice(i + 1).map((d) => (
                          <option key={`${d.oid}..${c.oid}`} value={`${d.oid}..${c.oid}`}>
                            {d.message.slice(0, 30)} → {c.message.slice(0, 30)}
                          </option>
                        )),
                      )}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <GitDiffViewer files={diffResult ?? []} loading={diffLoading} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center text-center px-6 gap-4">
          <div className="rounded-2xl bg-muted/20 p-6 ring-1 ring-border/40">
            <GitBranch className="size-10 text-muted-foreground/20" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground/80">{t("git.noRepoTitle")}</p>
            <p className="text-xs text-muted-foreground/60 max-w-[260px] leading-relaxed">
              {t("git.noRepoDescription")}
            </p>
          </div>

          <div className="flex w-full max-w-[300px] gap-2">
            <Input
              value={repoPathInput}
              onChange={(e) => setRepoPathInput(e.target.value)}
              placeholder={t("git.repoPathPlaceholder")}
              className="flex-1 text-xs h-8"
              readOnly={isTauriAvailable()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => (isTauriAvailable() ? pickRepoFolder() : setRepoPickerOpen(true))}
              className="h-8 shrink-0 gap-1"
            >
              <FolderOpen className="size-3.5" /> {t("git.browse")}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                setInitLoading(true);
                try {
                  await git.init(repoPathInput);
                } finally {
                  setInitLoading(false);
                }
              }}
              disabled={!repoPathInput.trim() || initLoading}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              {initLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <GitBranch className="size-3.5" />
              )}
              {initLoading ? t("git.initializing") : t("git.initNew")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setOpenLoading(true);
                try {
                  await git.open(repoPathInput);
                } finally {
                  setOpenLoading(false);
                }
              }}
              disabled={!repoPathInput.trim() || openLoading}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              {openLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FolderOpen className="size-3.5" />
              )}
              {openLoading ? t("git.opening") : t("git.openExisting")}
            </Button>
          </div>
        </div>
      )}

      <FolderPickerModal
        open={repoPickerOpen}
        onClose={() => setRepoPickerOpen(false)}
        onSelect={handleRepoFolderSelected}
        title={t("git.selectFolderModalTitle", "Sélectionner le dépôt Git")}
      />

      {/* Commit dialog */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <GitCommit className="size-4 text-primary" />
              {t("git.commitChanges")}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder={t("git.commitPlaceholder")}
            className="min-h-[80px] text-sm resize-none"
          />
          <details className="rounded-md border border-border/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t("git.commitAuthorName")} / {t("git.commitAuthorEmail")}
            </summary>
            <div className="mt-2 space-y-2">
              <Input
                value={commitAuthorName}
                onChange={(e) => setCommitAuthorName(e.target.value)}
                placeholder={t("git.commitAuthorNamePlaceholder")}
                autoComplete="name"
                className="text-sm"
              />
              <Input
                type="email"
                value={commitAuthorEmail}
                onChange={(e) => setCommitAuthorEmail(e.target.value)}
                placeholder={t("git.commitAuthorEmailPlaceholder")}
                autoComplete="email"
                className="text-sm"
              />
            </div>
          </details>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCommitDialogOpen(false)}
              className="text-xs"
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleCommit}
              disabled={
                !commitMessage.trim() ||
                !commitAuthorName.trim() ||
                !emailValid(commitAuthorEmail.trim()) ||
                commitLoading
              }
              className="text-xs"
            >
              {commitLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("git.committing")}
                </span>
              ) : (
                t("git.commit")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stash dialog */}
      <Dialog open={stashDialogOpen} onOpenChange={setStashDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Archive className="size-4 text-primary" />
              {t("git.stash")}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={stashMessage}
            onChange={(e) => setStashMessage(e.target.value)}
            placeholder={t("git.stashMessagePlaceholder")}
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleStashSave()}
          />
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setStashDialogOpen(false)}
              className="text-xs"
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleStashSave}
              disabled={stashLoading}
              className="text-xs gap-1.5"
            >
              {stashLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Archive className="size-3.5" />
              )}
              {t("git.stash")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommitRow({ commit, onDiff }: { commit: GitCommitType; onDiff: (oid: string) => void }) {
  const { t } = useTranslation();
  const date = new Date(commit.author.timestamp * 1000).toLocaleString();
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-accent/50 transition-colors">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
        <GitCommitHorizontal className="size-3 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{commit.message}</p>
        <p className="text-[10px] text-muted-foreground/60">
          {commit.author.name} • {date}
        </p>
      </div>
      <code className="hidden sm:inline-block text-[10px] text-muted-foreground/40 font-mono bg-muted/30 px-1 rounded shrink-0">
        {commit.oid.slice(0, 7)}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="size-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
        onClick={() => onDiff(commit.oid)}
        title={t("git.diffWithPrevious")}
      >
        <Diff className="size-3" />
      </Button>
    </div>
  );
}
