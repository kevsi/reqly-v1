"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Collection } from "@/hooks/use-request-store";

// ── Re-export des types pour les consommateurs (rétrocompatibilité) ─────

export type {
  GitCommit,
  FileStatus,
  DiffHunk,
  DiffFile,
  BranchInfo,
  RemoteInfo,
  GitCredentials,
  GitStashEntry,
  GitState,
} from "@/lib/git/types";

// ── Hook — fine couche d'adaptation React autour de GitService ──────────

import { GitService } from "@/lib/git/git-service";
import { TauriGitBackend, WebGitBackend } from "@/lib/git/git-backend";
import { isTauriAvailable } from "@/lib/tauri";
import { secureKeys } from "@/lib/secure-storage";
import type { DiffFile, GitCredentials, GitState } from "@/lib/git/types";

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
    stashes: [],
    conflicts: [],
    error: null,
    repoPath: null,
  });

  // S'abonner aux changements d'état du service et initialiser l'instance
  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new GitService(
        isTauriAvailable() ? new TauriGitBackend() : new WebGitBackend(),
      );
    }
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
  const collectionsRef = useRef(collections);
  useEffect(() => {
    collectionsRef.current = collections;
  }, [collections]);

  useEffect(() => {
    const svc = serviceRef.current;
    if (!svc) return;
    if (state.isInitialized && state.repoPath) {
      svc.startAutoSync(collectionsRef.current, state.repoPath);
    }
    return () => svc.stopAutoSync();
  }, [state.isInitialized, state.repoPath]);

  // ── Callbacks stabilisés (délèguent au service) ────────────────────

  const initRepo = useCallback(async (repoPath: string) => {
    const svc = serviceRef.current!;
    await svc.init(repoPath);
    // Sync collections immediately after init
    await svc.syncCollections(collectionsRef.current, repoPath);
  }, []);

  const openRepo = useCallback(async (repoPath: string) => {
    const svc = serviceRef.current!;
    await svc.open(repoPath);
    await svc.syncCollections(collectionsRef.current, repoPath);
  }, []);

  const doCommit = useCallback(
    async (message: string, authorName?: string, authorEmail?: string) => {
      const svc = serviceRef.current!;
      // Safeguard: sync one last time before commit
      const path = state.repoPath;
      if (path) await svc.syncCollections(collectionsRef.current, path);
      return await svc.commit(message, authorName, authorEmail);
    },
    [state.repoPath],
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

  const doRemoteRemove = useCallback(async (name: string) => {
    const svc = serviceRef.current!;
    await svc.remoteRemove(name);
    const err = svc.getState().error;
    if (err) throw new Error(err);
  }, []);

  const doLsRemote = useCallback(
    async (url: string): Promise<string[]> => serviceRef.current!.lsRemote(url),
    [],
  );

  // Desktop : si aucun identifiant n'est fourni, utiliser automatiquement le
  // token OAuth GitHub/GitLab déjà connecté (secure-storage). Le remote est
  // identifié par son URL configurée.
  const autoCredentials = useCallback(
    async (remoteName?: string): Promise<GitCredentials | undefined> => {
      if (!isTauriAvailable()) return undefined;
      try {
        await secureKeys.waitForReady();
      } catch {
        return undefined;
      }
      const svc = serviceRef.current;
      if (!svc) return undefined;
      const url =
        (remoteName ? svc.getState().remotes.find((r) => r.name === remoteName)?.url : "") ?? "";
      // Comparaison d'hôte STRICTE : `github.com.evil.com` ou `evil-github.com`
      // ne doivent JAMAIS recevoir le token (un `includes` permettrait
      // l'exfiltration du token OAuth vers un hôte attaquant).
      const host = new URL(url).hostname.toLowerCase();
      const isGithubHost = host === "github.com" || host.endsWith(".github.com");
      const isGitlabHost = host === "gitlab.com" || host.endsWith(".gitlab.com");
      if (isGithubHost) {
        const token = secureKeys.get("github_access_token");
        if (token) return { username: "x-access-token", password: token };
      }
      if (isGitlabHost) {
        const token = secureKeys.get("gitlab_access_token");
        if (token) return { username: "oauth2", password: token };
      }
      return undefined;
    },
    [],
  );

  const doPush = useCallback(
    async (remote: string, branch: string, credentials?: GitCredentials) => {
      const svc = serviceRef.current!;
      await svc.push(remote, branch, credentials ?? (await autoCredentials(remote)));
      const err = svc.getState().error;
      if (err) throw new Error(err);
    },
    [autoCredentials],
  );

  const doForcePush = useCallback(
    async (remote: string, branch: string, credentials?: GitCredentials) => {
      const svc = serviceRef.current!;
      await svc.forcePush(remote, branch, credentials ?? (await autoCredentials(remote)));
      const err = svc.getState().error;
      if (err) throw new Error(err);
    },
    [autoCredentials],
  );

  const doPull = useCallback(
    async (remote: string, branch: string, credentials?: GitCredentials) => {
      const svc = serviceRef.current!;
      await svc.pull(remote, branch, credentials ?? (await autoCredentials(remote)));
      const err = svc.getState().error;
      if (err) throw new Error(err);
    },
    [autoCredentials],
  );

  const doFetch = useCallback(
    async (remote: string, credentials?: GitCredentials) => {
      const svc = serviceRef.current!;
      await svc.fetch(remote, credentials ?? (await autoCredentials(remote)));
      const err = svc.getState().error;
      if (err) throw new Error(err);
    },
    [autoCredentials],
  );

  const doClone = useCallback(
    async (url: string, destPath: string, credentials?: GitCredentials): Promise<void> => {
      await serviceRef.current!.clone(
        url,
        destPath,
        credentials ?? (await autoCredentials(undefined)),
      );
      await serviceRef.current!.syncCollections(collectionsRef.current, destPath);
    },
    [autoCredentials],
  );

  const doDiff = useCallback(
    async (oidA: string, oidB: string): Promise<DiffFile[]> => serviceRef.current!.diff(oidA, oidB),
    [],
  );

  const doStashSave = useCallback(
    async (message?: string) => serviceRef.current!.stashSave(message),
    [],
  );

  const doStashPop = useCallback(async (index?: number) => serviceRef.current!.stashPop(index), []);

  const doStashApply = useCallback(
    async (index?: number) => serviceRef.current!.stashApply(index),
    [],
  );

  const doStashDrop = useCallback(
    async (index?: number) => serviceRef.current!.stashDrop(index),
    [],
  );

  const doRefresh = useCallback(async () => serviceRef.current!.refreshAll(), []);

  // Sur le web, fournit le FileSystemDirectoryHandle sélectionné au backend
  // (WebGitBackend.setHandle). Sans effet sur le backend Tauri.
  const setRepoHandle = useCallback((handle: FileSystemDirectoryHandle) => {
    const backend = serviceRef.current?.getBackend();
    if (backend && "setHandle" in backend) {
      (backend as unknown as { setHandle: (h: FileSystemDirectoryHandle) => void }).setHandle(
        handle,
      );
    }
  }, []);

  const clearError = useCallback(() => {
    serviceRef.current?.clearError();
  }, []);

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
    stashSave: doStashSave,
    stashPop: doStashPop,
    stashApply: doStashApply,
    stashDrop: doStashDrop,
    setRepoHandle,
    clearError,
  };
}
