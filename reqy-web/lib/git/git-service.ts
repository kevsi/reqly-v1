// ── Service Git — logique métier pure, sans dépendance React ──────────

import type { Collection } from "@/hooks/use-request-store";
import type { GitBackend } from "./git-backend";
import type {
  GitCommit,
  FileStatus,
  BranchInfo,
  RemoteInfo,
  DiffFile,
  GitState,
  GitStashEntry,
  GitCredentials,
} from "./types";

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Traduit les erreurs techniques courantes (isomorphic-git, HTTP, libgit2)
 * en message français actionnable. Le texte original est toujours conservé à
 * la fin (« Détail : … ») pour le diagnostic.
 *
 * Les messages déjà amicaux (contenant « Paramètres » ou « Détail technique »)
 * sont laissés tels quels pour éviter le double traitement.
 */
export function friendlyGitError(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("Paramètres") || raw.includes("Détail technique")) return raw;
  const r = raw.toLowerCase();
  const detail = `\nDétail : ${raw}`;

  if (
    r.includes("401") ||
    r.includes("403") ||
    r.includes("unauthorized") ||
    r.includes("forbidden") ||
    r.includes("authentication") ||
    r.includes("could not read username") ||
    r.includes("invalid credentials") ||
    r.includes("terminal prompts disabled")
  ) {
    return (
      "Connexion au dépôt refusée : l'authentification a échoué. " +
      "Connectez votre compte GitHub/GitLab dans Paramètres → Outils intégrés — " +
      "le token est utilisé automatiquement pour Git, aucune saisie n'est nécessaire sur la page Git." +
      detail
    );
  }
  if (
    r.includes("404") ||
    r.includes("not found") ||
    r.includes("repository not found") ||
    r.includes("no such file")
  ) {
    return (
      "Dépôt distant introuvable ou accès refusé : vérifiez l'URL du remote et que votre compte " +
      "a bien accès au dépôt." +
      detail
    );
  }
  if (
    r.includes("non-fast-forward") ||
    r.includes("updates were rejected") ||
    r.includes("fetch first") ||
    r.includes("rejected")
  ) {
    return (
      "Push refusé : le dépôt distant contient des commits que vous n'avez pas en local. " +
      "Récupérez d'abord les changements (flèche vers le bas), puis réessayez — ou utilisez le " +
      "Force Push (icône ⚠) si vous souhaitez écraser l'historique distant." +
      detail
    );
  }
  if (
    r.includes("network") ||
    r.includes("fetch failed") ||
    r.includes("econnrefused") ||
    r.includes("enotfound") ||
    r.includes("getaddrinfo") ||
    r.includes("timeout")
  ) {
    return (
      "Impossible de contacter le dépôt distant : vérifiez votre connexion internet et l'URL du remote." +
      detail
    );
  }
  return raw;
}

function errToString(err: unknown): string {
  if (err instanceof Error) return friendlyGitError(err.message);
  if (typeof err === "string") return friendlyGitError(err);
  // Tauri renvoie les erreurs Rust comme des objets plain { kind, code, message, detail }
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    // `detail` porte la vraie raison (ex. "Push failed: remote authentication
    // required"), `message` n'est que le libellé générique en français.
    if (typeof e["detail"] === "string" && e["detail"] !== e["message"]) {
      return friendlyGitError(e["detail"]);
    }
    if (typeof e["message"] === "string") return friendlyGitError(e["message"]);
    if (typeof e["error"] === "string") return friendlyGitError(e["error"]);
    try {
      return JSON.stringify(err);
    } catch {
      /* ignore */
    }
  }
  return String(err);
}

const INITIAL_STATE: GitState = {
  isInitialized: false,
  currentBranch: "main",
  commits: [],
  status: [],
  branches: [],
  remotes: [],
  stashes: [],
  conflicts: [],
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

  /** Accès au backend (utile pour injecter un handle web via setHandle). */
  getBackend(): GitBackend {
    return this._backend;
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

  clearError(): void {
    this._setState({ error: null });
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

  async push(remote: string, branch: string, credentials?: GitCredentials): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_push", {
        remote,
        branch,
        ...(credentials ? { credentials } : {}),
      });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async forcePush(remote: string, branch: string, credentials?: GitCredentials): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_push_force", {
        remote,
        branch,
        ...(credentials ? { credentials } : {}),
      });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async pull(remote: string, branch: string, credentials?: GitCredentials): Promise<void> {
    try {
      await this._backend.invoke("git_pull", {
        remote,
        branchName: branch,
        ...(credentials ? { credentials } : {}),
      });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async fetch(remote: string, credentials?: GitCredentials): Promise<void> {
    try {
      await this._backend.invoke("git_fetch", {
        remote,
        ...(credentials ? { credentials } : {}),
      });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async clone(url: string, destPath: string, credentials?: GitCredentials): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_clone", {
        url,
        destPath,
        ...(credentials ? { credentials } : {}),
      });
      this._setState({ isInitialized: true, repoPath: destPath });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
      throw err;
    }
  }

  // ── Stash ─────────────────────────────────────────────────────────────

  async stashSave(message?: string): Promise<string | null> {
    this._setState({ error: null });
    try {
      const oid = await this._backend.invoke<string>("git_stash_save", {
        message: message || null,
      });
      await this.refreshAll();
      return oid;
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
      return null;
    }
  }

  async stashPop(index?: number): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_stash_pop", { index: index ?? 0 });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async stashApply(index?: number): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_stash_apply", { index: index ?? 0 });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  async stashDrop(index?: number): Promise<void> {
    this._setState({ error: null });
    try {
      await this._backend.invoke("git_stash_drop", { index: index ?? 0 });
      await this.refreshAll();
    } catch (err: unknown) {
      this._setState({ error: errToString(err) });
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────

  async refreshAll(): Promise<void> {
    try {
      const [commits, status, branches, remotes, stashes] = await Promise.all([
        this._backend
          .invoke<GitCommit[]>("git_log", { maxCount: 50 })
          .catch(() => [] as GitCommit[]),
        this._backend.invoke<FileStatus[]>("git_status").catch(() => [] as FileStatus[]),
        this._backend.invoke<BranchInfo[]>("git_branch_list").catch(() => [] as BranchInfo[]),
        this._backend.invoke<RemoteInfo[]>("git_remote_list").catch(() => [] as RemoteInfo[]),
        this._backend.invoke<GitStashEntry[]>("git_stash_list").catch(() => [] as GitStashEntry[]),
      ]);
      const currentBranch = branches.find((b) => b.isCurrent)?.name ?? "main";

      // Détecter les fichiers en conflit (index non fusionné après un pull/merge)
      const conflicts = status.filter((s) => s.conflicted).map((s) => s.filepath);

      this._setState({
        commits,
        status,
        branches,
        remotes,
        stashes,
        conflicts,
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
