// ── Adaptateur fs pour isomorphic-git sur la File System Access API ────
//
// isomorphic-git attend un `FsClient` (interface node:fs en promesses).
// Ici on l'implémente par-dessus un `FileSystemDirectoryHandle` : le handle
// racine représente le répertoire "/" du dépôt. Les chemins de type
// "/foo/bar.txt" sont résolus en handles imbriqués.

export interface WebFsStat {
  ctimeSeconds: number;
  ctimeNanoseconds: number;
  mtimeSeconds: number;
  mtimeNanoseconds: number;
  dev: number;
  ino: number;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  /** isomorphic-git s'appuie sur l'API node:fs : il appelle isDirectory()/isFile(). */
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface WebFsClient {
  promises: {
    readFile(path: string, options?: { encoding?: string }): Promise<Uint8Array | string>;
    writeFile(
      path: string,
      data: Uint8Array | string,
      options?: { encoding?: string },
    ): Promise<void>;
    unlink(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    stat(path: string): Promise<WebFsStat>;
    lstat(path: string): Promise<WebFsStat>;
    readlink?(path: string): Promise<string>;
    symlink?(target: string, path: string): Promise<void>;
    chmod?(path: string, mode: number): Promise<void>;
  };
}

/** Erreur "fichier introuvable" au format attendu par isomorphic-git. */
function enoent(path: string): Error {
  const err = new Error(`ENOENT: no such file or directory, lstat '${path}'`);
  (err as Error & { code?: string }).code = "ENOENT";
  return err;
}

/**
 * Découpe un chemin en segments, en ignorant les segments vides et ".".
 * isomorphic-git émet des chemins comme `/.` ou `//` pour la racine ; la
 * File System Access API n'a pas de notion de "." (courant) ni de "..".
 */
function splitPath(path: string): string[] {
  return path.split("/").filter((p) => p !== "" && p !== ".");
}

function isNotFound(e: unknown): boolean {
  return (
    e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError")
  );
}

function dirStat(): WebFsStat {
  const now = Math.floor(Date.now() / 1000);
  return {
    ctimeSeconds: now,
    ctimeNanoseconds: 0,
    mtimeSeconds: now,
    mtimeNanoseconds: 0,
    dev: 1,
    ino: 0,
    mode: 0o040000,
    uid: 0,
    gid: 0,
    size: 0,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
}

export class FileSystemAccessFs implements WebFsClient {
  readonly promises: WebFsClient["promises"];

  // isomorphic-git s'appuie sur le "racy git" : si le stat d'un fichier
  // correspond à celui enregistré dans l'index, il réutilise l'oid sans
  // relire le contenu. `lastModified` du File System Access API est en
  // millisecondes ; on le reporte tel quel dans mtimeSeconds/ctimeSeconds
  // pour que deux écritures proches soient toujours distinguées, quel que
  // soit l'environnement (le champ ino n'est pas comparé sous Windows/node).
  // On fait aussi varier `ino` à chaque écriture par sécurité.
  private _inoByPath = new Map<string, number>();
  private _nextIno = 0;

  private inoFor(path: string, refresh: boolean): number {
    const key = splitPath(path).join("/");
    if (refresh || !this._inoByPath.has(key)) {
      this._inoByPath.set(key, ++this._nextIno);
    }
    return this._inoByPath.get(key) as number;
  }

  constructor(private root: FileSystemDirectoryHandle) {
    this.promises = {
      readFile: (path, options) => this.readFile(path, options),
      writeFile: (path, data, options) => this.writeFile(path, data, options),
      unlink: (path) => this.unlink(path),
      readdir: (path) => this.readdir(path),
      mkdir: (path) => this.mkdir(path),
      rmdir: (path) => this.rmdir(path),
      stat: (path) => this.stat(path),
      lstat: (path) => this.stat(path),
      readlink: () => Promise.reject(enoent("/")),
      symlink: () => Promise.reject(new Error("symlink not supported on web")),
      chmod: () => Promise.resolve(),
    };
  }

  // ── Résolution de chemins ───────────────────────────────────────────

  private async resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
    const parts = splitPath(path);
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part);
      } catch (e) {
        if (isNotFound(e)) throw enoent(path);
        throw e;
      }
    }
    return dir;
  }

  private async resolveFile(path: string): Promise<FileSystemFileHandle> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw enoent(path);
    const dir = await this.resolveDir(parts.join("/"));
    try {
      return await dir.getFileHandle(name);
    } catch (e) {
      if (isNotFound(e)) throw enoent(path);
      throw e;
    }
  }

  // ── Lecture / écriture ──────────────────────────────────────────────

  private async readFile(
    path: string,
    options?: { encoding?: string },
  ): Promise<Uint8Array | string> {
    const fileHandle = await this.resolveFile(path);
    const file = await fileHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (options?.encoding === "utf8") {
      return new TextDecoder().decode(bytes);
    }
    return bytes;
  }

  private async writeFile(
    path: string,
    data: Uint8Array | string,
    _options?: { encoding?: string },
  ): Promise<void> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw enoent(path);
    const dir = await this.resolveDir(parts.join("/"));
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    // Marque le fichier comme modifié pour le cache "racy git" d'isomorphic-git.
    this.inoFor(path, true);
  }

  private async unlink(path: string): Promise<void> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw enoent(path);
    const dir = await this.resolveDir(parts.join("/"));
    try {
      await dir.removeEntry(name);
    } catch (e) {
      if (isNotFound(e)) throw enoent(path);
      throw e;
    }
  }

  // ── Répertoires ─────────────────────────────────────────────────────

  private async readdir(path: string): Promise<string[]> {
    const dir = await this.resolveDir(path);
    const names: string[] = [];
    // `entries()` existe dans la spec File System Access mais pas dans la lib
    // DOM de TypeScript — on itère via l'AsyncIterator du handle.
    const iterable = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name] of iterable) names.push(name);
    return names;
  }

  private async mkdir(path: string): Promise<void> {
    const parts = splitPath(path);
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  }

  private async rmdir(path: string): Promise<void> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw enoent(path);
    const dir = await this.resolveDir(parts.join("/"));
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch (e) {
      if (isNotFound(e)) throw enoent(path);
      throw e;
    }
  }

  // ── Stat ────────────────────────────────────────────────────────────

  private async stat(path: string): Promise<WebFsStat> {
    if (path === "/" || path === "") return dirStat();

    const parts = splitPath(path);
    if (parts.length === 0) return dirStat();
    const name = parts[parts.length - 1];
    const parent = await this.resolveDir(parts.slice(0, -1).join("/"));

    // Fichier ?
    try {
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      // `lastModified` est en millisecondes. On le reporte tel quel dans
      // mtimeSeconds/ctimeSeconds (et non en secondes) : le cache "racy git"
      // d'isomorphic-git compare ces champs, et deux écritures dans la même
      // seconde seraient sinon confondues (le champ ino n'est de plus pas
      // comparé sous Windows/node).
      const lastModified = file.lastModified;
      return {
        ctimeSeconds: lastModified,
        ctimeNanoseconds: 0,
        mtimeSeconds: lastModified,
        mtimeNanoseconds: 0,
        dev: 1,
        ino: this.inoFor(path, false),
        mode: 0o100644,
        uid: 0,
        gid: 0,
        size: file.size,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      };
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }

    // Répertoire ?
    try {
      await parent.getDirectoryHandle(name);
      return dirStat();
    } catch (e) {
      if (isNotFound(e)) throw enoent(path);
      throw e;
    }
  }
}
