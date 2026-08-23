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
});
