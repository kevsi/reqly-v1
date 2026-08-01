"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { Collection } from "@/hooks/use-request-store";

// ── Re-export des types pour les consommateurs (rétrocompatibilité) ─────

export type {
  GitCommit,
  FileStatus,
  DiffHunk,
  DiffFile,
  BranchInfo,
  RemoteInfo,
  GitState,
} from "@/lib/git/types";

// ── Hook — fine couche d'adaptation React autour de GitService ──────────

import { GitService } from "@/lib/git/git-service";
import { TauriGitBackend } from "@/lib/git/git-backend";
import type {
  GitCommit,
  FileStatus,
  BranchInfo,
  RemoteInfo,
  DiffFile,
  GitState,
} from "@/lib/git/types";

export function useGit(collections: Collection[]) {
  // Instance stable du service (créée une fois)
  const serviceRef = useRef<GitService | null>(null);
  const [state, setState] = useState<GitState>({
    isInitialized: false,
    currentBranch: "",
    commits: [],
    status: [],
    branches: [],
    remotes: [],
    error: null,
    repoPath: null,
  });

  // S'abonner aux changements d'état du service et initialiser l'instance
  useEffect(() => {
    if (!serviceRef.current) serviceRef.current = new GitService(new TauriGitBackend());
    const svc = serviceRef.current;
    setState(svc.getState());
    const unsub = svc.subscribe((newState) => setState(newState));

    // Auto-detect on mount
    let cancelled = false;
    (async () => {
      try {
        const initialized = await svc.checkInitialized();
        if (!cancelled && initialized) {
          await svc.refreshAll();
        }
      } catch {
        // Pas de repo
      }
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // ── Auto-sync collections to disk (debounced) ──────────────────────
  useEffect(() => {
    const svc = serviceRef.current;
    if (!svc) return;
    if (state.isInitialized && state.repoPath) {
      svc.startAutoSync(collections, state.repoPath);
    }
    return () => svc.stopAutoSync();
  }, [collections, state.isInitialized, state.repoPath]);

  // ── Callbacks stabilisés (délèguent au service) ────────────────────

  const initRepo = useCallback(
    async (repoPath: string) => {
      const svc = serviceRef.current!;
      await svc.init(repoPath);
      // Sync collections immediately after init
      await svc.syncCollections(collections, repoPath);
    },
    [collections],
  );

  const openRepo = useCallback(
    async (repoPath: string) => {
      const svc = serviceRef.current!;
      await svc.open(repoPath);
      await svc.syncCollections(collections, repoPath);
    },
    [collections],
  );

  const doCommit = useCallback(
    async (message: string, authorName?: string, authorEmail?: string) => {
      const svc = serviceRef.current!;
      // Safeguard: sync one last time before commit
      const path = state.repoPath;
      if (path) await svc.syncCollections(collections, path);
      return await svc.commit(message, authorName, authorEmail);
    },
    [collections, state.repoPath],
  );

  const doStage = useCallback(async (filepath: string) => serviceRef.current!.stage(filepath), []);

  const doStageAll = useCallback(async () => serviceRef.current!.stageAll(), []);

  const doUnstage = useCallback(
    async (filepath: string) => serviceRef.current!.unstage(filepath),
    [],
  );

  const doBranchCreate = useCallback(
    async (name: string, fromOid?: string) => serviceRef.current!.branchCreate(name, fromOid),
    [],
  );

  const doBranchDelete = useCallback(
    async (name: string) => serviceRef.current!.branchDelete(name),
    [],
  );

  const doBranchSwitch = useCallback(
    async (name: string) => serviceRef.current!.branchSwitch(name),
    [],
  );

  const doRemoteAdd = useCallback(
    async (name: string, url: string) => serviceRef.current!.remoteAdd(name, url),
    [],
  );

  const doRemoteRemove = useCallback(
    async (name: string) => serviceRef.current!.remoteRemove(name),
    [],
  );

  const doLsRemote = useCallback(
    async (url: string): Promise<string[]> => serviceRef.current!.lsRemote(url),
    [],
  );

  const doPush = useCallback(
    async (remote: string, branch: string) => serviceRef.current!.push(remote, branch),
    [],
  );

  const doForcePush = useCallback(
    async (remote: string, branch: string) => serviceRef.current!.forcePush(remote, branch),
    [],
  );

  const doPull = useCallback(
    async (remote: string, branch: string) => serviceRef.current!.pull(remote, branch),
    [],
  );

  const doFetch = useCallback(async (remote: string) => serviceRef.current!.fetch(remote), []);

  const doClone = useCallback(
    async (url: string, destPath: string): Promise<void> => {
      await serviceRef.current!.clone(url, destPath);
      await serviceRef.current!.syncCollections(collections, destPath);
    },
    [collections],
  );

  const doDiff = useCallback(
    async (oidA: string, oidB: string): Promise<DiffFile[]> => serviceRef.current!.diff(oidA, oidB),
    [],
  );

  const doRefresh = useCallback(async () => serviceRef.current!.refreshAll(), []);

  // ── Return ─────────────────────────────────────────────────────────

  return {
    ...state,
    init: initRepo,
    open: openRepo,
    commit: doCommit,
    log: doRefresh,
    refreshStatus: doRefresh,
    diff: doDiff,
    stage: doStage,
    stageAll: doStageAll,
    unstage: doUnstage,
    branchCreate: doBranchCreate,
    branchDelete: doBranchDelete,
    branchSwitch: doBranchSwitch,
    remoteAdd: doRemoteAdd,
    remoteRemove: doRemoteRemove,
    lsRemote: doLsRemote,
    push: doPush,
    forcePush: doForcePush,
    fetch: doFetch,
    pull: doPull,
    clone: doClone,
  };
}
