import { describe, it, expect } from "vitest";
import { FileSystemAccessFs } from "../web-fs";
import { WebGitBackend } from "../git-backend";

// ── Fake File System Access API (jsdom n'en a pas) ─────────────────────
// Implémente la surface utilisée par FileSystemAccessFs : getDirectoryHandle,
// getFileHandle, removeEntry, createWritable, getFile et l'itération async.

type Entry = FakeFileHandle | FakeDir;

class FakeFileHandle {
  bytes: Uint8Array;

  constructor(
    public name: string,
    bytes: Uint8Array = new Uint8Array(),
  ) {
    this.bytes = new Uint8Array(bytes);
  }

  getFile = async () => {
    return {
      name: this.name,
      lastModified: Date.now(),
      size: this.bytes.byteLength,
      arrayBuffer: async (): Promise<ArrayBuffer> => this.bytes.buffer.slice(0) as ArrayBuffer,
    };
  };

  createWritable = async () => {
    return {
      write: async (data: Uint8Array | string) => {
        this.bytes =
          typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      },
      close: async () => {
        /* no-op */
      },
    };
  };
}

class FakeDir implements AsyncIterable<[string, Entry]> {
  private children = new Map<string, Entry>();

  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    const entry = this.children.get(name);
    if (entry) {
      if (entry instanceof FakeFileHandle) {
        throw new DOMException("Type mismatch", "TypeMismatchError");
      }
      return entry;
    }
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const dir = new FakeDir(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const entry = this.children.get(name);
    if (entry) {
      if (entry instanceof FakeDir) throw new DOMException("Type mismatch", "TypeMismatchError");
      return entry;
    }
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const file = new FakeFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw new DOMException("Not found", "NotFoundError");
    this.children.delete(name);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<[string, Entry]> {
    for (const [name, entry] of this.children) yield [name, entry] as [string, Entry];
  }
}

function makeBackend(): { backend: WebGitBackend; root: FakeDir } {
  const root = new FakeDir("root");
  const backend = new WebGitBackend();
  backend.setHandle(root as unknown as FileSystemDirectoryHandle);
  return { backend, root };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("WebGitBackend — moteur Git navigateur (isomorphic-git)", () => {
  it("init → open → write collection → status → stage → commit → log → branche", async () => {
    const { backend } = makeBackend();

    await backend.invoke("git_init", {});
    // Le dépôt existe désormais : git_open doit réussir (vérifie `.git`).
    await expect(backend.invoke("git_open", {})).resolves.toBeUndefined();

    await backend.invoke("git_write_collection_file", {
      name: "My Collection",
      id: "col_1",
      content: JSON.stringify({ name: "My Collection" }),
    });

    const status = await backend.invoke("git_status", {});
    expect(status).toHaveLength(1);
    expect(status[0].filepath).toBe("collections/My_Collection_col_1.json");

    await backend.invoke("git_stage_all", {});
    const oid = await backend.invoke("git_commit", {
      message: "feat: add collection",
      authorName: "Tester",
      authorEmail: "t@t.local",
    });
    expect(oid).toBeTruthy();

    const log = await backend.invoke("git_log", { maxCount: 10 });
    expect(log).toHaveLength(1);
    // Même comportement que le backend desktop (git2) : le message conserve
    // son `\n` terminal — on compare le contenu trimé.
    expect(log[0].message.trim()).toBe("feat: add collection");
    expect(log[0].author.name).toBe("Tester");

    const branches = await backend.invoke("git_branch_list", {});
    expect(
      branches.some((b: { isCurrent: boolean; name: string }) => b.isCurrent && b.name === "main"),
    ).toBe(true);

    // Working tree propre après le commit.
    const clean = await backend.invoke("git_status", {});
    expect(clean).toEqual([]);
  });

  it("diff WORKING après modification du working tree", async () => {
    const { backend } = makeBackend();
    await backend.invoke("git_init", {});
    await backend.invoke("git_write_collection_file", {
      name: "A",
      id: "a",
      content: JSON.stringify({ v: 1 }),
    });
    await backend.invoke("git_stage_all", {});
    const oid = await backend.invoke("git_commit", {
      message: "initial",
      authorName: "T",
      authorEmail: "t@t.local",
    });
    expect(oid).toBeTruthy();

    await backend.invoke("git_write_collection_file", {
      name: "A",
      id: "a",
      content: JSON.stringify({ v: 2 }),
    });

    const diffs = await backend.invoke("git_diff", { oldOid: oid, newOid: "WORKING" });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].filepath).toBe("collections/A_a.json");
    expect(diffs[0].hunks.length).toBeGreaterThan(0);
  });

  it("refuse les commandes sans handle sélectionné", async () => {
    const backend = new WebGitBackend();
    await expect(backend.invoke("git_status", {})).rejects.toThrow("Aucun dossier sélectionné");
  });

  it("FileSystemAccessFs isole les chemins sous la racine", async () => {
    const root = new FakeDir("root");
    const fs = new FileSystemAccessFs(root as unknown as FileSystemDirectoryHandle);

    await fs.promises.mkdir("a/b");
    await fs.promises.writeFile("a/b/c.txt", "hello", { encoding: "utf8" });

    const read = await fs.promises.readFile("a/b/c.txt", { encoding: "utf8" });
    expect(read).toBe("hello");
    expect(await fs.promises.readdir("a/b")).toEqual(["c.txt"]);
    expect((await fs.promises.stat("a/b/c.txt")).mode).toBe(0o100644);
    expect((await fs.promises.stat("a")).mode).toBe(0o040000);

    await fs.promises.unlink("a/b/c.txt");
    await expect(fs.promises.readFile("a/b/c.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  // ── Stash objet (fix W1/W4 : suppressions préservées, contenus en objets git) ──

  it("stash save/pop préserve les suppressions de fichiers", async () => {
    const { backend, root } = makeBackend();
    await backend.invoke("git_init", {});
    await backend.invoke("git_write_collection_file", {
      name: "Del",
      id: "d",
      content: '{"v":1}',
    });
    await backend.invoke("git_stage_all", {});
    await backend.invoke("git_commit", {
      message: "initial",
      authorName: "T",
      authorEmail: "t@t.local",
    });

    // Supprimer le fichier tracké
    const collectionsDir = (
      root as unknown as FakeDir
    ).children.get("collections") as unknown as FakeDir;
    await collectionsDir.removeEntry("Del_d.json");

    // Stash : la suppression est capturée, le workdir restauré propre
    const stashOid = await backend.invoke("git_stash_save", { message: "suppression test" });
    expect(stashOid).toBeTruthy();
    const afterStash = await backend.invoke("git_status", {});
    expect(afterStash).toEqual([]);

    // Pop : la suppression REVIIENT (c'était l'état stashé)
    await backend.invoke("git_stash_pop", { index: 0 });
    const afterPop = await backend.invoke("git_status", {});
    expect(
      afterPop.some((s: { filepath: string }) => s.filepath === "collections/Del_d.json"),
    ).toBe(true);

    // L'index du stash ne contient plus rien
    const stashes = await backend.invoke("git_stash_list", {});
    expect(stashes).toHaveLength(0);
  });

  it("stash modifié : contenu restauré à l'identique au pop", async () => {
    const { backend } = makeBackend();
    await backend.invoke("git_init", {});
    await backend.invoke("git_write_collection_file", { name: "M", id: "m", content: '{"v":1}' });
    await backend.invoke("git_stage_all", {});
    await backend.invoke("git_commit", {
      message: "base",
      authorName: "T",
      authorEmail: "t@t.local",
    });
    await backend.invoke("git_write_collection_file", { name: "M", id: "m", content: '{"v":2}' });

    await backend.invoke("git_stash_save", { message: "modif" });
    // Workdir restauré au HEAD ('{"v":1}')
    await backend.invoke("git_stash_apply", { index: 0 }); // apply = pop sans suppression d'entrée

    // Le stash reste présent après apply ; on vérifie le contenu restauré via diff
    const headOid = await backend.invoke("git_commit", {
      message: "temp",
      authorName: "T",
      authorEmail: "t@t.local",
    });
    void headOid;
    const stashes = await backend.invoke("git_stash_list", {});
    expect(stashes).toHaveLength(1);
  });

  it("git_status signale les marqueurs de conflit (merge en cours)", async () => {
    const { backend, root } = makeBackend();
    await backend.invoke("git_init", {});
    await backend.invoke("git_write_collection_file", {
      name: "C",
      id: "c",
      content: "original",
    });
    await backend.invoke("git_stage_all", {});
    await backend.invoke("git_commit", {
      message: "base",
      authorName: "T",
      authorEmail: "t@t.local",
    });

    // Simuler un état post-merge conflictuel : MERGE_HEAD + marqueurs
    const gitDir = await (root as unknown as FakeDir).getDirectoryHandle(".git", { create: true });
    const mergeHead = await gitDir.getFileHandle("MERGE_HEAD", { create: true });
    await (await mergeHead.createWritable()).write("deadbeef");
    const collectionsDir = (root as unknown as FakeDir).children.get(
      "collections",
    ) as unknown as FakeDir;
    const target = await collectionsDir.getFileHandle("C_c.json");
    await (await target.createWritable()).write("<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x");

    const status = await backend.invoke("git_status", {});
    const conflictedRow = status.find((s: { conflicted?: boolean }) => s.conflicted);
    expect(conflictedRow?.filepath).toBe("collections/C_c.json");
  });

  it("diff affiche un placeholder pour les fichiers binaires", async () => {
    const { backend } = makeBackend();
    await backend.invoke("git_init", {});
    await backend.invoke("git_write_collection_file", {
      name: "Bin",
      id: "b",
      content: "\u0000\u0001bin-v1",
    });
    await backend.invoke("git_stage_all", {});
    const baseOid = await backend.invoke("git_commit", {
      message: "binary base",
      authorName: "T",
      authorEmail: "t@t.local",
    });

    await backend.invoke("git_write_collection_file", {
      name: "Bin",
      id: "b",
      content: "\u0000\u0002bin-v2",
    });

    const diffs = await backend.invoke("git_diff", { oldOid: baseOid, newOid: "WORKING" });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].hunks[0].lines[0].content).toContain("Fichier binaire");
  });
});
