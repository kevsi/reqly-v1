// ── Interface injectable pour abstraire les appels Tauri ──────────────

import type { BranchInfo, DiffFile, FileStatus, GitCommit, GitCredentials } from "./types";
import { FileSystemAccessFs, type WebFsClient } from "./web-fs";
import { diffText } from "./web-diff";

/**
 * Entrée d'index du stash web : `oid` pointe vers un commit git réel dont
 * l'arbre contient les fichiers stashés ; `deleted` liste les chemins qui
 * étaient supprimés (à re-supprimer au pop).
 */
interface WebStashEntry {
  index: number;
  message: string;
  oid: string;
  deleted?: string[];
}

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
        try {
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
        } catch (err) {
          // isomorphic-git ne gère pas les merges conflictuels : il échoue
          // avant d'écrire quoi que ce soit. On traduit en guidance actionnable
          // au lieu de laisser une erreur brute incompréhensible.
          const msg = err instanceof Error ? err.message : String(err);
          if (/conflict|merge|non.?fast.?forward/i.test(msg)) {
            throw new Error(
              `Conflit lors du pull de '${branchName}' : stash vos modifications ` +
                `(git_stash_save), relancez le pull, puis ré-appliquez le stash ` +
                `(git_stash_pop). Détail technique : ${msg}`,
              { cause: err },
            );
          }
          throw err;
        }
        return undefined as T;
      }

      case "git_clone": {
        const url = args?.url as string;
        const credentials = args?.credentials as GitCredentials | null | undefined;
        const http = await this._getWebHttpClient();
        // Sur le web, le handle courant (défini via setHandle) est la destination.
        // Clone COMPLET : un singleBranch empêcherait ensuite tout checkout vers
        // une autre branche (objets absents → erreurs obscures).
        await git.clone({
          fs,
          dir,
          url,
          singleBranch: false,
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
        await this._webStashPop(git, fs, dir, index, false);
        return undefined as T;
      }

      case "git_stash_apply": {
        const index = (args?.index as number) ?? 0;
        await this._webStashPop(git, fs, dir, index, true);
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
        const conflictedPaths = await this._detectConflicts(git, fs, dir, matrix);
        const status: FileStatus[] = matrix
          .filter(([, head, workdir, staged]) => head !== 1 || workdir !== 1 || staged !== 1)
          .map(([filepath, head, workdir, staged]) => ({
            filepath: filepath as string,
            head: head as 0 | 1,
            workdir: workdir as 0 | 1 | 2,
            staged: staged as 0 | 1 | 2 | 3,
            // isomorphic-git n'expose pas de flux de fusion : on détecte les
            // conflits par marqueurs `<<<<<<<` dans les fichiers modifiés.
            conflicted: conflictedPaths.has(filepath as string),
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
        let directError: unknown;
        try {
          return await http.request(req);
        } catch (err) {
          // On préserve la cause d'origine : si le fallback proxy échoue
          // aussi, l'erreur finale doit mentionner LES DEUX causes.
          directError = err;
        }
        try {
          const proxyUrl = `/api/git/proxy?url=${encodeURIComponent(req.url)}`;
          return await http.request({
            ...req,
            url: proxyUrl,
          });
        } catch (proxyErr) {
          const directMsg =
            directError instanceof Error ? directError.message : String(directError);
          const proxyMsg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
          throw new Error(
            `Requête Git impossible en direct (${directMsg}) et via le proxy (${proxyMsg})`,
            { cause: proxyErr },
          );
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

  /**
   * Stash web — stocké comme de VRAIS objets git (blob → tree → commit),
   * pas comme un JSON en clair. L'index `.git/reqly-stashes.json` ne contient
   * que des métadonnées (oid du commit stash, message, liste des suppressions).
   * Les contenus de fichiers vivent dans les objets git compressés, au même
   * titre qu'un `git stash` natif.
   */
  private async _readWebStashes(fs: WebFsClient): Promise<WebStashEntry[]> {
    try {
      const content = await fs.promises.readFile(".git/reqly-stashes.json", { encoding: "utf8" });
      const parsed = JSON.parse(
        typeof content === "string" ? content : new TextDecoder().decode(content),
      ) as WebStashEntry[];
      // Ancien format (contenus en clair dans `files`) : non supporté, ignoré.
      return parsed.filter((e) => typeof e?.oid === "string" && e.oid.length >= 7);
    } catch {
      return [];
    }
  }

  private async _writeWebStashes(fs: WebFsClient, stashes: WebStashEntry[]): Promise<void> {
    await fs.promises.writeFile(".git/reqly-stashes.json", JSON.stringify(stashes, null, 2), {
      encoding: "utf8",
    });
  }

  /**
   * Construit l'arborescence d'objets tree correspondant à un mapping
   * chemin → contenu (les arbres git sont à un niveau : "a/b.json" exige un
   * sous-arbre "a" référencé en mode 040000).
   */
  private async _writeStashTree(
    git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
    files: Record<string, string>,
  ): Promise<string> {
    const encoder = new TextEncoder();

    const writeLevel = async (levelEntries: Record<string, string>): Promise<string> => {
      const here: Array<{
        mode: "100644" | "040000";
        path: string;
        oid: string;
        type: "blob" | "tree";
      }> = [];
      const subtrees = new Map<string, Record<string, string>>();

      for (const [path, content] of Object.entries(levelEntries)) {
        const slash = path.indexOf("/");
        if (slash === -1) {
          const oid = await git.writeBlob({ fs, dir, blob: encoder.encode(content) });
          here.push({ mode: "100644", path, oid, type: "blob" });
        } else {
          const head = path.slice(0, slash);
          const rest = path.slice(slash + 1);
          const bucket = subtrees.get(head) ?? {};
          bucket[rest] = content;
          subtrees.set(head, bucket);
        }
      }

      for (const [name, bucket] of subtrees) {
        const subOid = await writeLevel(bucket);
        here.push({ mode: "040000", path: name, oid: subOid, type: "tree" });
      }

      return await git.writeTree({ fs, dir, tree: here });
    };

    return await writeLevel(files);
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

    let headOid: string | undefined;
    try {
      headOid = await git.resolveRef({ fs, dir, ref: "HEAD" });
    } catch {
      // dépôt sans commit initial : parent = []
    }

    // ── Capture de l'état du workdir ─────────────────────────────────
    // - fichiers modifiés / ajoutés : contenu courant
    // - fichiers supprimés : PAS de contenu (rien à sauver) mais on retient
    //   le chemin pour re-supprimer le fichier au pop. Avant ce fix, la
    //   suppression était perdue silencieusement par le checkout force.
    const filesToSave: Record<string, string> = {};
    const deletedPaths: string[] = [];
    for (const [filepath, head, workdir] of modified) {
      if (workdir !== 0) {
        try {
          const content = await fs.promises.readFile(filepath, { encoding: "utf8" });
          filesToSave[filepath] =
            typeof content === "string" ? content : new TextDecoder().decode(content);
        } catch {
          filesToSave[filepath] = "";
        }
      } else if (head === 1) {
        deletedPaths.push(filepath);
      }
    }

    // ── Écriture en objets git réels : blobs → trees imbriqués → commit ──
    // Un arbre git ne contient qu'UN niveau par objet : "a/b.json" exige un
    // sous-arbre "a". On construit donc l'arborescence récursivement.
    const stashTreeOid = await this._writeStashTree(git, fs, dir, filesToSave);

    const stashMsg = message || `WIP on ${await git.currentBranch({ fs, dir }).catch(() => "main")}`;
    const author = {
      name: "Reqly",
      email: "stash@reqly.local",
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: 0,
    };
    const stashOid = await git.writeCommit({
      fs,
      dir,
      commit: {
        message: `stash: ${stashMsg}`,
        tree: stashTreeOid,
        parent: headOid ? [headOid] : [],
        author,
        committer: author,
      },
    });

    const stashes = await this._readWebStashes(fs);
    stashes.unshift({ index: 0, message: stashMsg, oid: stashOid, deleted: deletedPaths });
    stashes.forEach((s, idx) => (s.index = idx));
    await this._writeWebStashes(fs, stashes);

    // Restaure le workdir propre (= HEAD), comme un vrai git stash.
    const currentBranch = await git.currentBranch({ fs, dir }).catch(() => "main");
    if (currentBranch) {
      await git.checkout({ fs, dir, ref: currentBranch, force: true }).catch(() => undefined);
    }

    return stashOid;
  }

  private async _webStashPop(
    git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
    index: number = 0,
    keep: boolean = false,
  ): Promise<void> {
    const stashes = await this._readWebStashes(fs);
    if (index < 0 || index >= stashes.length) {
      throw new Error(`No stash entry found at index ${index}`);
    }

    const entry = stashes[index];
    // Relit l'arbre du commit stash (RÉCURSIF : les sous-dossiers sont des
    // arbres séparés) et réécrit les fichiers du workdir.
    // readTree renvoie { oid, tree: <entrées[]> }.
    const { commit } = await git.readCommit({ fs, dir, oid: entry.oid });
    const decoder = new TextDecoder();
    const restoreLevel = async (prefix: string, treeOid: string): Promise<void> => {
      const { tree } = await git.readTree({ fs, dir, oid: treeOid });
      for (const item of tree) {
        if (item.type === "tree") {
          await restoreLevel(`${prefix}${item.path}/`, item.oid);
        } else if (item.type === "blob") {
          const { blob } = await git.readBlob({ fs, dir, oid: item.oid });
          await fs.promises.writeFile(`${prefix}${item.path}`, decoder.decode(blob), {
            encoding: "utf8",
          });
        }
      }
    };
    await restoreLevel("", commit.tree);
    // Re-supprime les fichiers qui étaient supprimés au moment du stash.
    for (const path of entry.deleted ?? []) {
      await fs.promises.unlink(path).catch(() => undefined);
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

      // Tracking : upstream = refs/remotes/<origin>/<branche> si présent,
      // et ahead/behind calculés par comparaison des historiques (profondeur
      // plafonnée — approximation suffisante pour l'affichage UI).
      let upstream: string | null = null;
      let ahead = 0;
      let behind = 0;
      const remoteRef = `refs/remotes/origin/${name}`;
      try {
        const remoteOid = await git.resolveRef({ fs, dir, ref: remoteRef });
        if (oid && remoteOid) {
          upstream = `origin/${name}`;
          if (oid !== remoteOid) {
            const counts = await this._aheadBehind(git, fs, dir, oid, remoteOid);
            ahead = counts.ahead;
            behind = counts.behind;
          }
        }
      } catch {
        // pas d'upstream configuré pour cette branche
      }

      result.push({
        name,
        isCurrent: name === current,
        oid,
        upstream,
        ahead,
        behind,
      });
    }
    return result;
  }

  /**
   * Compte les commits présents d'un seul côté entre deux refs, en comparant
   * les ensembles d'oids des deux historiques (profondeur plafonnée à 100 :
   * au-delà, l'affichage se contente de "≥").
   */
  private async _aheadBehind(
    git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
    localOid: string,
    remoteOid: string,
  ): Promise<{ ahead: number; behind: number }> {
    try {
      const [localLog, remoteLog] = await Promise.all([
        git.log({ fs, dir, ref: localOid, depth: 100 }),
        git.log({ fs, dir, ref: remoteOid, depth: 100 }),
      ]);
      const localSet = new Set(localLog.map((c) => c.oid));
      const remoteSet = new Set(remoteLog.map((c) => c.oid));
      let ahead = 0;
      for (const c of localLog) if (!remoteSet.has(c.oid)) ahead++;
      let behind = 0;
      for (const c of remoteLog) if (!localSet.has(c.oid)) behind++;
      return { ahead, behind };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  /**
   * Détecte les fichiers en conflit dans le workdir. isomorphic-git n'expose
   * pas de flux de fusion : un conflit se manifeste par des marqueurs
   * `<<<<<<<` dans le contenu. Scan plafonné (200 fichiers × 64 Ko) pour ne
   * pas transformer chaque statut en lecture intégrale du dépôt.
   */
  private async _detectConflicts(
    _git: typeof import("isomorphic-git"),
    fs: WebFsClient,
    dir: string,
    matrix: Awaited<ReturnType<typeof import("isomorphic-git").statusMatrix>>,
  ): Promise<Set<string>> {
    const conflicted = new Set<string>();
    // Un merge est-il en cours ? (.git/MERGE_HEAD présent)
    let mergeInProgress = false;
    try {
      await fs.promises.stat(`${dir}.git/MERGE_HEAD`);
      mergeInProgress = true;
    } catch {
      /* pas de merge en cours */
    }
    if (!mergeInProgress) return conflicted;

    const CAP_FILES = 200;
    const CAP_BYTES = 65_536;
    let scanned = 0;
    for (const row of matrix) {
      if (scanned >= CAP_FILES) break;
      const filepath = row[0] as string;
      const workdir = row[2] as number;
      if (workdir === 0) continue; // fichier supprimé : rien à scanner
      scanned++;
      try {
        const data = await fs.promises.readFile(filepath, { encoding: "utf8" });
        const text =
          typeof data === "string" ? data.slice(0, CAP_BYTES) : new TextDecoder().decode(data.slice(0, CAP_BYTES));
        if (text.includes("<<<<<<<")) conflicted.add(filepath);
      } catch {
        /* illisible : ignoré */
      }
    }
    return conflicted;
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

      const readOldBytes = async (): Promise<Uint8Array | null> => {
        if (!aOid) return null;
        try {
          const { blob } = await git.readBlob({ fs, dir, oid: aOid, filepath });
          return blob;
        } catch {
          return null;
        }
      };
      const readNewBytes = async (): Promise<Uint8Array | null> => {
        if (!bOid) return null;
        if (newOid === "WORKING") {
          try {
            const data = await fs.promises.readFile(filepath);
            return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
          } catch {
            return null;
          }
        }
        try {
          const { blob } = await git.readBlob({ fs, dir, oid: bOid, filepath });
          return blob;
        } catch {
          return null;
        }
      };

      const [oldBytes, newBytes] = [await readOldBytes(), await readNewBytes()];

      // Fichier binaire (octet NUL dans l'en-tête) : ne pas décoder en UTF-8
      // (mojibake géant) — afficher un placeholder.
      if (looksBinary(oldBytes) || looksBinary(newBytes)) {
        files.push({
          filepath,
          hunks: [
            {
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: 0,
              lines: [
                {
                  origin: "context",
                  content: "Fichier binaire non affiché.",
                  oldLineno: null,
                  newLineno: null,
                },
              ],
            },
          ],
        });
        continue;
      }

      const oldText = oldBytes ? new TextDecoder().decode(oldBytes) : "";
      const newText = newBytes ? new TextDecoder().decode(newBytes) : "";

      files.push({ filepath, hunks: diffText(oldText, newText) });
    }
    return files;
  }
}

/** Heuristique standard : un octet NUL dans les 8 000 premiers octets ⇒ binaire. */
function looksBinary(bytes: Uint8Array | null): boolean {
  if (!bytes) return false;
  const cap = Math.min(bytes.length, 8000);
  for (let i = 0; i < cap; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
