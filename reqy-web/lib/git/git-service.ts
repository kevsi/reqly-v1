// ── Service Git — logique métier pure, sans dépendance React ──────────

import type { Collection } from "@/hooks/use-request-store";
import type { GitBackend } from "./git-backend";
import type { GitCommit, FileStatus, BranchInfo, RemoteInfo, DiffFile, GitState } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────

function errToString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const INITIAL_STATE: GitState = {
  isInitialized: false,
  currentBranch: "main",
  commits: [],
  status: [],
  branches: [],
  remotes: [],
  error: null,
  repoPath: null,
};

type Listener = (state: GitState) => void;

// ── Service ─────────────────────────────────────────────────────────────

export class GitService {
  private _state: GitState = { ...INITIAL_STATE };
  private _listeners = new Set<Listener>();
  private _backend: GitBackend;

  // Debounce pour l'auto-sync
  private _syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(backend: GitBackend) {
    this._backend = backend;
  }

  // ── État / souscription ─────────────────────────────────────────────

  getState(): GitState {
    return this._state;
  }

  subscribe(cb: Listener): () => void {
    this._listeners.add(cb);
    return () => {
      this._listeners.delete(cb);
    };
  }

  private _notify(): void {
    // Snapshot pour éviter les mutations concurrentes
    const snapshot = { ...this._state };
    this._listeners.forEach((cb) => cb(snapshot));
  }

  private _setState(partial: Partial<GitState>): void {
    this._state = { ...this._state, ...partial };
    this._notify();
  }

  // ── Initialisation ───────────────────────────────────────────────────

  async init(repoPath: string): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_init", { path: repoPath });
      this._setState({ isInitialized: true, repoPath });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async open(repoPath: string): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_open", { path: repoPath });
      this._setState({ isInitialized: true, repoPath });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async checkInitialized(): Promise<boolean> {
    try {
      const branches = await this._backend.invoke<BranchInfo[]>("git_branch_list");
      return branches.length > 0;
    } catch {
      return false;
    }
  }

  // ── Commit ────────────────────────────────────────────────────────────

  async commit(message: string, authorName?: string, authorEmail?: string): Promise<string | null> {
    this._setState({ error: null });
    try {
      const oid = await this._backend.invoke<string>("git_commit", {
        message,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
      });
      await this.refreshAll();
      return oid;
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
      return null;
    }
  }

  // ── Stage ─────────────────────────────────────────────────────────────

  async stage(filepath: string): Promise<void> {
    try {
      await this._backend.invoke("git_stage", { filepath });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async stageAll(): Promise<void> {
    try {
      await this._backend.invoke("git_stage_all");
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async unstage(filepath: string): Promise<void> {
    try {
      await this._backend.invoke("git_unstage", { filepath });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  // ── Branches ──────────────────────────────────────────────────────────

  async branchCreate(name: string, fromOid?: string): Promise<void> {
    try {
      await this._backend.invoke("git_branch_create", {
        name,
        fromOid: fromOid || null,
      });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async branchDelete(name: string): Promise<void> {
    try {
      await this._backend.invoke("git_branch_delete", { name });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async branchSwitch(name: string): Promise<void> {
    try {
      await this._backend.invoke("git_branch_switch", { name });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  // ── Remotes ───────────────────────────────────────────────────────────

  async remoteAdd(name: string, url: string): Promise<void> {
    try {
      await this._backend.invoke("git_remote_add", { name, url });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async remoteRemove(name: string): Promise<void> {
    try {
      await this._backend.invoke("git_remote_remove", { name });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async lsRemote(url: string): Promise<string[]> {
    return await this._backend.invoke<string[]>("git_ls_remote", { url });
  }

  // ── Push / Pull / Fetch ──────────────────────────────────────────────

  async push(remote: string, branch: string): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_push", { remote, branch });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async forcePush(remote: string, branch: string): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_push_force", { remote, branch });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async pull(remote: string, branch: string): Promise<void> {
    try {
      await this._backend.invoke("git_pull", { remote, branchName: branch });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async fetch(remote: string): Promise<void> {
    try {
      await this._backend.invoke("git_fetch", { remote });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async clone(url: string, destPath: string): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_clone", { url, destPath });
      this._setState({ isInitialized: true, repoPath: destPath });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────

  async refreshAll(): Promise<void> {
    try {
      const [commits, status, branches, remotes] = await Promise.all([
        this._backend
          .invoke<GitCommit[]>("git_log", { maxCount: 50 })
          .catch(() => [] as GitCommit[]),
        this._backend.invoke<FileStatus[]>("git_status").catch(() => [] as FileStatus[]),
        this._backend.invoke<BranchInfo[]>("git_branch_list").catch(() => [] as BranchInfo[]),
        this._backend.invoke<RemoteInfo[]>("git_remote_list").catch(() => [] as RemoteInfo[]),
      ]);
      const currentBranch = branches.find((b) => b.isCurrent)?.name ?? "main";
      this._setState({
        commits,
        status,
        branches,
        remotes,
        currentBranch,
      });
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async diff(oidA: string, oidB: string): Promise<DiffFile[]> {
    try {
      return await this._backend.invoke<DiffFile[]>("git_diff", {
        oldOid: oidA,
        newOid: oidB,
      });
    } catch {
      return [];
    }
  }

  // ── Collection sync ───────────────────────────────────────────────────

  async syncCollections(collections: Collection[], repoDir: string): Promise<void> {
    // Écrit toutes les collections sur le disque dans le dossier collections/
    await Promise.all(
      collections.map((col) =>
        this._backend
          .invoke("git_write_collection_file", {
            name: col.name || "unnamed",
            id: col.id,
            content: JSON.stringify(col, null, 2),
            repoDir,
          })
          .catch(() => {
            /* best-effort per file */
          }),
      ),
    );
    // Rafraîchir le status après sync
    try {
      const status = await this._backend.invoke<FileStatus[]>("git_status");
      this._setState({ status });
    } catch {
      // ignorer
    }
  }

  startAutoSync(collections: Collection[], repoDir: string): void {
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this.syncCollections(collections, repoDir);
    }, 500);
  }

  stopAutoSync(): void {
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
    }
  }
}
