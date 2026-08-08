import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

// Ces tests valident que le hook appelle les bonnes commandes Tauri.
// Les vrais tests d'intégration nécessitent Tauri (hors scope pour l'instant).

describe("useGit hook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("git_branch_list returns expected shape", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "main", isCurrent: true, oid: "abc123", upstream: null, ahead: 0, behind: 0 },
    ]);

    const result = await invoke("git_branch_list");
    const branches = result as Array<{ name: string; isCurrent: boolean }>;

    expect(Array.isArray(branches)).toBe(true);
    expect(branches[0].name).toBe("main");
    expect(branches[0].isCurrent).toBe(true);
  });

  it("git_log returns commits", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        oid: "abc",
        message: "Initial commit",
        author: { name: "Test", email: "test@test.com" },
        timestamp: 1234567890,
      },
    ]);

    const result = await invoke("git_log", { maxCount: 10 });
    const commits = result as Array<{ oid: string; message: string }>;

    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe("Initial commit");
  });

  it("git_status returns file statuses", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { filepath: "test.txt", head: 1, workdir: 2, staged: 1 },
    ]);

    const result = await invoke("git_status");
    const statuses = result as Array<{ filepath: string; head: number }>;

    expect(statuses).toHaveLength(1);
    expect(statuses[0].filepath).toBe("test.txt");
    expect(statuses[0].head).toBe(1);
  });

  it("git_commit calls with message", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("def456");

    const oid = await invoke<string>("git_commit", {
      message: "Fix bug",
      authorName: null,
      authorEmail: null,
    });

    expect(oid).toBe("def456");
    expect(invoke).toHaveBeenCalledWith("git_commit", {
      message: "Fix bug",
      authorName: null,
      authorEmail: null,
    });
  });
});
