// ── Interface injectable pour abstraire les appels Tauri ──────────────

import type { BranchInfo, DiffFile, FileStatus, GitCommit, GitCredentials } from "./types";
import { FileSystemAccessFs, type WebFsClient } from "./web-fs";
import { diffText } from "./web-diff";

/**
 * GitBackend is the seam between GitService and the actual git engine.
 * In production, TauriGitBackend calls `invoke()` (desktop IPC).
 * WebGitBackend uses isomorphic-git over the File System Access API.
 * In tests, a mock backend returns canned responses.
 */
export interface GitBackend {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

/**
 * Production backend — delegates to @tauri-apps/api/core invoke.
 */
export class TauriGitBackend implements GitBackend {
  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<T>(cmd, args);
    } catch (err: unknown) {
      // Tauri renvoie les erreurs Rust comme des objets plain { kind, code, message, detail }
      // On les wrape en Error JS pour que les consommateurs obtiennent un message lisible.
      if (err && typeof err === "object") {
        const e = err as Record<string, unknown>;
        const msg =
          typeof e["message"] === "string"
            ? e["message"]
            : typeof e["error"] === "string"
              ? e["error"]
              : JSON.stringify(err);
        throw new Error(msg, { cause: err });
      }
      throw err;
    }
  }
}

/**
 * Backend web — moteur Git navigateur basé sur isomorphic-git.
 *
 * Le dossier sélectionné via la File System Access API (bouton Parcourir)
 * est fourni par `setHandle()` ; il représente la racine "/" du dépôt.
 * Les opérations réseau (clone/push/pull/fetch/ls-remote) utilisent le
 * client HTTP web d'isomorphic-git et restent soumises aux CORS du serveur.
 */
export class WebGitBackend implements GitBackend {
  private _handle: FileSystemDirectoryHandle | null = null;
  private _fs: WebFsClient | null = null;

  setHandle(handle: FileSystemDirectoryHandle): void {
    this._handle = handle;
    this._fs = new FileSystemAccessFs(handle);
  }

  get hasHandle(): boolean {
    return this._handle !== null;
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!this._handle || !this._fs) {
      throw new Error(
        "Aucun dossier sélectionné. Utilisez le bouton Parcourir pour choisir un dossier.",
      );
    }
    const git = await import("isomorphic-git");
    const fs = this._fs;
    const dir = "/";

    switch (cmd) {
      case "git_init": {
        await git.init({ fs, dir, defaultBranch: "main" });
        return undefined as T;
      }

      case "git_open": {
        const hasGit = await this._hasGitDir(git, fs, dir);
        if (!hasGit) throw new Error("Le dossier sélectionné n'est pas un dépôt Git.");
        return undefined as T;
      }

      case "git_branch_list": {
        return (await this._listBranches(git, fs, dir)) as T;
      }

      case "git_commit": {
        const message = (args?.message as string) ?? "";
        const authorName = (args?.authorName as string) || "Reqly User";
        const authorEmail = (args?.authorEmail as string) || "user@reqly.local";
        const oid = await git.commit({
          fs,
          dir,
          message,
          author: { name: authorName, email: authorEmail },
          committer: { name: authorName, email: authorEmail },
        });
        return oid as T;
      }

      case "git_stage": {
        const filepath = args?.filepath as string;
        await git.add({ fs, dir, filepath });
        return undefined as T;
      }

      case "git_stage_all": {
        // isomorphic-git `add(".")` ne stage pas les suppressions : on les
        // retire d'abord de l'index pour reproduire `git add -A`.
        const matrix = await git.statusMatrix({ fs, dir });
        for (const [filepath, head, workdir] of matrix) {
          if (head === 1 && workdir === 0) {
            await git.remove({ fs, dir, filepath });
          }
        }
        await git.add({ fs, dir, filepath: "." });
        return undefined as T;
      }

      case "git_unstage": {
        const filepath = args?.filepath as string;
        await git.resetIndex({ fs, dir, filepath });
        return undefined as T;
      }

      case "git_branch_create": {
        const name = args?.name as string;
        const fromOid = (args?.fromOid as string | null) ?? undefined;
        await git.branch({ fs, dir, ref: name, checkout: false, object: fromOid });
        return undefined as T;
      }

      case "git_branch_delete": {
        const name = args?.name as string;
        await git.deleteBranch({ fs, dir, ref: name });
        return undefined as T;
      }

      case "git_branch_switch": {
        const name = args?.name as string;
        await git.checkout({ fs, dir, ref: name });
        return undefined as T;
      }

      case "git_remote_list": {
        const remotes = await git.listRemotes({ fs, dir });
        return remotes.map((r) => ({ name: r.remote, url: r.url })) as T;
      }

      case "git_remote_add": {
        const name = args?.name as string;
        const url = args?.url as string;
        await git.addRemote({ fs, dir, remote: name, url });
        return undefined as T;
      }

      case "git_remote_remove": {
        const name = args?.name as string;
        await git.deleteRemote({ fs, dir, remote: name });
        return undefined as T;
      }

      case "git_ls_remote": {
        const url = args?.url as string;
        const http = await this._getWebHttpClient();
        const refs = await git.listServerRefs({ http, url });
        const branches = refs
          .filter((r) => r.ref.startsWith("refs/heads/"))
          .map((r) => r.ref.slice("refs/heads/".length));
        if (branches.length === 0) throw new Error("No branches found on remote");
        return branches as T;
      }

      case "git_push": {
        const remote = args?.remote as string;
        const branch = args?.branch as string;
        const credentials = args?.credentials as GitCredentials | null | undefined;
        const http = await this._getWebHttpClient();
        await git.push({
          fs,
          dir,
          remote,
          ref: branch,
          http,
          onAuth: this._authCallback(credentials),
        });
        return undefined as T;
      }

      case "git_push_force": {
        const remote = args?.remote as string;
        const branch = args?.branch as string;
        const credentials = args?.credentials as GitCredentials | null | undefined;
        const http = await this._getWebHttpClient();
        await git.push({
          fs,
          dir,
          remote,
          ref: branch,
          force: true,
          http,
          onAuth: this._authCallback(credentials),
        });
        return undefined as T;
      }

      case "git_fetch": {
        const remote = args?.remote as string;
        const credentials = args?.credentials as GitCredentials | null | undefined;
        const http = await this._getWebHttpClient();
        await git.fetch({ fs, dir, remote, http, onAuth: this._authCallback(credentials) });
        return undefined as T;
      }

      case "git_pull": {
        const remote = args?.remote as string;
        const branchName = args?.branchName as string;
        const credentials = args?.credentials as GitCredentials | null | undefined;
        const http = await this._getWebHttpClient();
        await git.pull({
          fs,
          dir,
          remote,
          ref: branchName,
          singleBranch: true,
          http,
          onAuth: this._authCallback(credentials),
          author: { name: "Reqly User", email: "user@reqly.local" },
          committer: { name: "Reqly User", email: "user@reqly.local" },
        });
        return undefined as T;
      }

      case "git_clone": {
        const url = args?.url as string;
        const credentials = args?.credentials as GitCredentials | null | undefined;
        const http = await this._getWebHttpClient();
        // Sur le web, le handle courant (défini via setHandle) est la destination.
        await git.clone({
          fs,
          dir,
          url,
          singleBranch: true,
          http,
          onAuth: this._authCallback(credentials),
        });
        return undefined as T;
      }

      case "git_stash_save": {
        const message = args?.message as string | undefined;
        return (await this._webStashSave(git, fs, dir, message)) as T;
      }

      case "git_stash_pop": {
        const index = (args?.index as number) ?? 0;
        await this._webStashPop(fs, index, false);
        return undefined as T;
      }

      case "git_stash_apply": {
        const index = (args?.index as number) ?? 0;
        await this._webStashPop(fs, index, true);
        return undefined as T;
      }

      case "git_stash_drop": {
        const index = (args?.index as number) ?? 0;
        const stashes = await this._readWebStashes(fs);
        if (index >= 0 && index < stashes.length) {
          stashes.splice(index, 1);
          stashes.forEach((s, idx) => (s.index = idx));
          await this._writeWebStashes(fs, stashes);
        }
        return undefined as T;
      }

      case "git_stash_list": {
        const stashes = await this._readWebStashes(fs);
        return stashes.map((s) => ({
          index: s.index,
          message: s.message,
          oid: s.oid,
        })) as T;
      }

      case "git_log": {
        const maxCount = (args?.maxCount as number) ?? 50;
        const commits = await git.log({ fs, dir, depth: maxCount });
        return commits.map((c): GitCommit => ({
          oid: c.oid,
          message: c.commit.message,
          author: {
            name: c.commit.author.name,
            email: c.commit.author.email,
            timestamp: c.commit.author.timestamp,
          },
          committer: {
            name: c.commit.committer.name,
            email: c.commit.committer.email,
            timestamp: c.commit.committer.timestamp,
          },
          timestamp: c.commit.committer.timestamp,
        })) as T;
      }

      case "git_status": {
        const matrix = await git.statusMatrix({ fs, dir });
        const status: FileStatus[] = matrix
          .filter(([, head, workdir, staged]) => head !== 1 || workdir !== 1 || staged !== 1)
          .map(([filepath, head, workdir, staged]) => ({
            filepath: filepath as string,
            head: head as 0 | 1,
            workdir: workdir as 0 | 1 | 2,
            staged: staged as 0 | 1 | 2 | 3,
            // Le web n'a pas de flux de fusion : aucun conflit possible.
            conflicted: false,
          }));
        return status as T;
      }

      case "git_diff": {
        const oldOid = args?.oldOid as string;
        const newOid = args?.newOid as string;
        return (await this._computeDiff(git, fs, dir, oldOid, newOid)) as T;
      }

      case "git_write_collection_file": {
        const name = (args?.name as string) || "unnamed";
        const id = (args?.id as string) || "unknown";
        const content = (args?.content as string) ?? "";
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filepath = `collections/${safeName}_${safeId}.json`;
        await fs.promises.mkdir("collections").catch(() => undefined);
        await fs.promises.writeFile(filepath, content, { encoding: "utf8" });
        return undefined as T;
      }

      default:
        throw new Error(`Commande Git non supportée sur le web : ${cmd}`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async _getWebHttpClient() {
    const { default: http } = await import("isomorphic-git/http/web");
    return {
      async request(req: Parameters<typeof http.request>[0]) {
        try {
          return await http.request(req);
        } catch {
          const proxyUrl = `/api/git/proxy?url=${encodeURIComponent(req.url)}`;
          return await http.request({
            ...req,
            url: proxyUrl,
          });
        }
      },
    };
  }

  private _authCallback(credentials?: GitCredentials | null) {
    if (!credentials?.username || !credentials.password) return undefined;
    return () => ({
      username: credentials.username,
      password: credentials.password,
    });
  }

  private async _readWebStashes(
    fs: WebFsClient,
  ): Promise<
    Array<{ index: number; message: string; oid: string; files: Record<string, string> }>
  > {
    try {
      const content = await fs.promises.readFile(".git/reqly-stashes.json", { encoding: "utf8" });
      return JSON.parse(typeof content === "string" ? content : new TextDecoder().decode(content));
    } catch {
      return [];
    }
  }

  private async _writeWebStashes(
    fs: WebFsClient,
    stashes: Array<{ index: number; message: string; oid: string; files: Record<string, string> }>,
  ): Promise<void> {
    await fs.promises.writeFile(".git/reqly-stashes.json", JSON.stringify(stashes, null, 2), {
      encoding: "utf8",
    });
  }

  private async _webStashSave(
    git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
    message?: string,
  ): Promise<string> {
    const matrix = await git.statusMatrix({ fs, dir });
    const modified = matrix.filter(
      ([, head, workdir, staged]) => head !== 1 || workdir !== 1 || staged !== 1,
    );
    if (modified.length === 0) {
      throw new Error("No local changes to stash");
    }

    const filesToSave: Record<string, string> = {};
    for (const [filepath, , workdir] of modified) {
      if (workdir !== 0) {
        try {
          const content = await fs.promises.readFile(filepath, { encoding: "utf8" });
          filesToSave[filepath] =
            typeof content === "string" ? content : new TextDecoder().decode(content);
        } catch {
          filesToSave[filepath] = "";
        }
      }
    }

    const stashes = await this._readWebStashes(fs);
    const oid =
      Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const stashMsg =
      message || `WIP on ${await git.currentBranch({ fs, dir }).catch(() => "main")}`;

    stashes.unshift({
      index: 0,
      message: stashMsg,
      oid,
      files: filesToSave,
    });

    stashes.forEach((s, idx) => (s.index = idx));
    await this._writeWebStashes(fs, stashes);

    const currentBranch = await git.currentBranch({ fs, dir }).catch(() => "main");
    if (currentBranch) {
      await git.checkout({ fs, dir, ref: currentBranch, force: true }).catch(() => undefined);
    }

    return oid;
  }

  private async _webStashPop(
    fs: WebFsClient,
    index: number = 0,
    keep: boolean = false,
  ): Promise<void> {
    const stashes = await this._readWebStashes(fs);
    if (index < 0 || index >= stashes.length) {
      throw new Error(`No stash entry found at index ${index}`);
    }

    const entry = stashes[index];
    for (const [filepath, content] of Object.entries(entry.files)) {
      await fs.promises.writeFile(filepath, content, { encoding: "utf8" });
    }

    if (!keep) {
      stashes.splice(index, 1);
      stashes.forEach((s, idx) => (s.index = idx));
      await this._writeWebStashes(fs, stashes);
    }
  }

  private async _hasGitDir(
    _git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
  ): Promise<boolean> {
    // Un dépôt = présence d'un répertoire `.git` à la racine. On évite
    // resolveRef("HEAD") qui échoue sur un dépôt vide (init sans commit).
    try {
      await fs.promises.stat(`${dir}.git`);
      return true;
    } catch {
      return false;
    }
  }

  private async _listBranches(
    git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
  ): Promise<BranchInfo[]> {
    const names = await git.listBranches({ fs, dir });
    const current = await git.currentBranch({ fs, dir });
    const result: BranchInfo[] = [];
    for (const name of names) {
      let oid = "";
      try {
        oid = await git.resolveRef({ fs, dir, ref: `refs/heads/${name}` });
      } catch {
        // branche sans commit
      }
      result.push({
        name,
        isCurrent: name === current,
        oid,
        upstream: null,
        ahead: 0,
        behind: 0,
      });
    }
    return result;
  }

  private async _computeDiff(
    git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
    oldOid: string,
    newOid: string,
  ): Promise<DiffFile[]> {
    const trees =
      newOid === "WORKING"
        ? [git.TREE({ ref: oldOid }), git.WORKDIR()]
        : [git.TREE({ ref: oldOid }), git.TREE({ ref: newOid })];

    const changed = await git.walk({
      fs,
      dir,
      trees,
      map: async (filepath, entries) => {
        if (filepath === ".") return;
        // git n'affiche jamais le répertoire interne `.git` dans un diff.
        if (filepath === ".git" || filepath.startsWith(".git/")) return;
        const [A, B] = entries;
        const [aType, bType] = await Promise.all([A ? A.type() : null, B ? B.type() : null]);
        // Dossiers seulement : pas d'entrée de diff (les walkers rendent un
        // `oid` de blob uniquement pour les fichiers).
        if (aType !== "blob" && bType !== "blob") return;
        const aOid = A && aType === "blob" ? await A.oid() : null;
        const bOid = B && bType === "blob" ? await B.oid() : null;
        if (aOid !== bOid) return { filepath, aOid, bOid };
      },
      reduce: async (parent, children) => {
        // Le reduce par défaut d'isomorphic-git préfixe `parent` (résultat du
        // map du nœud courant) ; on reproduit ce comportement en aplatissant.
        const flattened = children.flat();
        if (parent) flattened.unshift(parent);
        return flattened as Array<{
          filepath: string;
          aOid: string | null;
          bOid: string | null;
        }>;
      },
    });

    const files: DiffFile[] = [];
    for (const item of changed) {
      const { filepath, aOid, bOid } = item;

      let oldText = "";
      if (aOid) {
        try {
          const { blob } = await git.readBlob({ fs, dir, oid: oldOid, filepath });
          oldText = new TextDecoder().decode(blob);
        } catch {
          oldText = "";
        }
      }

      let newText = "";
      if (bOid) {
        if (newOid === "WORKING") {
          try {
            const data = await fs.promises.readFile(filepath, { encoding: "utf8" });
            newText = typeof data === "string" ? data : new TextDecoder().decode(data);
          } catch {
            newText = "";
          }
        } else {
          try {
            const { blob } = await git.readBlob({ fs, dir, oid: newOid, filepath });
            newText = new TextDecoder().decode(blob);
          } catch {
            newText = "";
          }
        }
      }

      files.push({ filepath, hunks: diffText(oldText, newText) });
    }
    return files;
  }
}
