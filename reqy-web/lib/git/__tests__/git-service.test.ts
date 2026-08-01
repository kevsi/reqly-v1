import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitService } from "../git-service";
import type { GitBackend } from "../git-backend";
import type { Collection } from "@/hooks/use-request-store";

// ── Helpers ─────────────────────────────────────────────────────────────

function mockBackend(): GitBackend {
  return { invoke: vi.fn() };
}

function mockCollection(overrides?: Partial<Collection>): Collection {
  return {
    id: "col_123",
    name: "Test Collection",
    color: "#3b82f6",
    icon: "folder",
    requests: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Collection;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("GitService", () => {
  let backend: GitBackend;
  let service: GitService;

  beforeEach(() => {
    backend = mockBackend();
    service = new GitService(backend);
  });

  // ── État initial ─────────────────────────────────────────────────────

  it("should start with default state", () => {
    const state = service.getState();
    expect(state.isInitialized).toBe(false);
    expect(state.repoPath).toBeNull();
    expect(state.error).toBeNull();
    expect(state.commits).toEqual([]);
    expect(state.status).toEqual([]);
    expect(state.branches).toEqual([]);
    expect(state.remotes).toEqual([]);
    expect(state.currentBranch).toBe("main");
  });

  // ── Subscribe ─────────────────────────────────────────────────────────

  it("should notify subscribers on state change", async () => {
    const listener = vi.fn();
    const unsub = service.subscribe(listener);

    // init() calls setState({ isLoading: true }) synchronously before await
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no repo"));
    service.init("/tmp/test");

    // Sync setState fires immediately
    expect(listener).toHaveBeenCalledTimes(1);

    // Wait for the async rejection to trigger the catch's setState
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have been called at least once more (the error state)
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsub();
  });

  it("should stop notifying after unsubscribe", async () => {
    const listener = vi.fn();
    const unsub = service.subscribe(listener);

    // Trigger a sync state change — init() calls setState({ isLoading: true })
    // synchronously before the first await
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    service.init("/tmp/test");

    // The first setState is sync → listener has been called once
    expect(listener).toHaveBeenCalledTimes(1);

    // Now unsubscribe
    unsub();

    // Wait for the async rejection to trigger the catch's setState
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Listener should NOT have been called again after unsub
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // ── Init ──────────────────────────────────────────────────────────────

  it("should init repo successfully", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // refreshAll calls (4 parallel invokes)
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_init
    // refreshAll mocks
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_log
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_status
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_branch_list
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_remote_list

    await service.init("/tmp/test-repo");

    expect(backend.invoke).toHaveBeenCalledWith("git_init", {
      path: "/tmp/test-repo",
    });
    expect(service.getState().isInitialized).toBe(true);
    expect(service.getState().repoPath).toBe("/tmp/test-repo");
  });

  it("should handle init error", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Permission denied"));

    await service.init("/tmp/bad-path");

    expect(service.getState().isInitialized).toBe(false);
    expect(service.getState().repoPath).toBeNull();
    expect(service.getState().error).toContain("Permission denied");
  });

  // ── Open ──────────────────────────────────────────────────────────────

  it("should open existing repo", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_open
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_log
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_status
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_branch_list
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_remote_list

    await service.open("/tmp/existing-repo");

    expect(service.getState().isInitialized).toBe(true);
    expect(service.getState().repoPath).toBe("/tmp/existing-repo");
  });

  // ── Commit ────────────────────────────────────────────────────────────

  it("should commit and return oid", async () => {
    // commit calls
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce("abc123def"); // git_commit
    // refreshAll
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_log
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_status
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_branch_list
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_remote_list

    const oid = await service.commit("feat: test commit");

    expect(oid).toBe("abc123def");
    expect(backend.invoke).toHaveBeenCalledWith("git_commit", {
      message: "feat: test commit",
      authorName: null,
      authorEmail: null,
    });
  });

  it("should return null on commit error", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("nothing to commit"));

    const oid = await service.commit("test");

    expect(oid).toBeNull();
    expect(service.getState().error).toContain("nothing to commit");
  });

  // ── Stage ─────────────────────────────────────────────────────────────

  it("should stage a file", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_stage
    // refreshAll
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await service.stage("collections/test.json");

    expect(backend.invoke).toHaveBeenCalledWith("git_stage", {
      filepath: "collections/test.json",
    });
  });

  // ── Branch operations ─────────────────────────────────────────────────

  it("should create a branch", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_branch_create
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_log
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_status
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_branch_list
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_remote_list

    await service.branchCreate("feature/new");

    expect(backend.invoke).toHaveBeenCalledWith("git_branch_create", {
      name: "feature/new",
      fromOid: null,
    });
  });

  // ── Remote operations ─────────────────────────────────────────────────

  it("should add a remote", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_remote_add
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await service.remoteAdd("origin", "https://github.com/user/repo.git");

    expect(backend.invoke).toHaveBeenCalledWith("git_remote_add", {
      name: "origin",
      url: "https://github.com/user/repo.git",
    });
  });

  it("should ls remote", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(["main", "develop"]);

    const branches = await service.lsRemote("https://github.com/user/repo.git");

    expect(branches).toEqual(["main", "develop"]);
    expect(backend.invoke).toHaveBeenCalledWith("git_ls_remote", {
      url: "https://github.com/user/repo.git",
    });
  });

  // ── Push / Pull / Fetch / Clone ───────────────────────────────────────

  it("should push", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_push
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await service.push("origin", "main");

    expect(backend.invoke).toHaveBeenCalledWith("git_push", {
      remote: "origin",
      branch: "main",
    });
  });

  it("should handle push reject (non-fast-forward)", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Push rejected (non-fast-forward)"),
    );

    await service.push("origin", "main");

    expect(service.getState().error).toContain("non-fast-forward");
  });

  it("should clone", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // git_clone
    // refreshAll
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await service.clone("https://github.com/user/repo.git", "/tmp/clone");

    expect(service.getState().isInitialized).toBe(true);
    expect(service.getState().repoPath).toBe("/tmp/clone");
  });

  // ── Queries ───────────────────────────────────────────────────────────

  it("should refresh state from all git queries", async () => {
    const mockCommits = [
      {
        oid: "abc",
        message: "commit 1",
        author: { name: "Test", email: "t@t.com", timestamp: 1000 },
        committer: { name: "Test", email: "t@t.com", timestamp: 1000 },
        timestamp: 1000,
      },
    ];
    const mockStatus = [
      { filepath: "test.json", head: 0 as const, workdir: 2 as const, staged: 1 as const },
    ];
    const mockBranches = [
      { name: "main", isCurrent: true, oid: "abc", upstream: null, ahead: 0, behind: 0 },
    ];
    const mockRemotes = [{ name: "origin", url: "https://github.com/user/repo.git" }];

    (backend.invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockCommits) // git_log
      .mockResolvedValueOnce(mockStatus) // git_status
      .mockResolvedValueOnce(mockBranches) // git_branch_list
      .mockResolvedValueOnce(mockRemotes); // git_remote_list

    await service.refreshAll();

    const state = service.getState();
    expect(state.commits).toEqual(mockCommits);
    expect(state.status).toEqual(mockStatus);
    expect(state.branches).toEqual(mockBranches);
    expect(state.remotes).toEqual(mockRemotes);
    expect(state.currentBranch).toBe("main");
  });

  it("should return empty array on diff error", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("invalid oid"));

    const result = await service.diff("bad", "oids");
    expect(result).toEqual([]);
  });

  // ── Sync collections ──────────────────────────────────────────────────

  it("should sync collections to disk", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined); // git_write_collection_file
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // first col
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined); // second col
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // git_status refresh

    const collections = [
      mockCollection({ id: "c1", name: "API v1" }),
      mockCollection({ id: "c2", name: "Test Suite" }),
    ];

    await service.syncCollections(collections, "/tmp/repo");

    expect(backend.invoke).toHaveBeenCalledWith("git_write_collection_file", {
      name: "API v1",
      id: "c1",
      content: expect.any(String),
      repoDir: "/tmp/repo",
    });
    expect(backend.invoke).toHaveBeenCalledWith("git_write_collection_file", {
      name: "Test Suite",
      id: "c2",
      content: expect.any(String),
      repoDir: "/tmp/repo",
    });
  });

  // ── Auto-sync debounce ────────────────────────────────────────────────

  it("should debounce auto-sync calls", async () => {
    vi.useFakeTimers();

    const syncSpy = vi.spyOn(service, "syncCollections");
    syncSpy.mockResolvedValue(undefined);

    const collections = [mockCollection()];
    const repoDir = "/tmp/repo";

    // Call startAutoSync three times rapidly
    service.startAutoSync(collections, repoDir);
    service.startAutoSync(collections, repoDir);
    service.startAutoSync(collections, repoDir);

    // Should not have synced yet
    expect(syncSpy).not.toHaveBeenCalled();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(500);

    // Should have synced exactly once
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith(collections, repoDir);

    syncSpy.mockRestore();
    vi.useRealTimers();
  });

  it("should stop auto-sync", () => {
    vi.useFakeTimers();

    const syncSpy = vi.spyOn(service, "syncCollections");
    syncSpy.mockResolvedValue(undefined);

    service.startAutoSync([mockCollection()], "/tmp/repo");
    service.stopAutoSync();

    vi.advanceTimersByTime(1000);

    expect(syncSpy).not.toHaveBeenCalled();

    syncSpy.mockRestore();
    vi.useRealTimers();
  });

  // ── CheckInitialized ──────────────────────────────────────────────────

  it("should detect initialized repo", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "main", isCurrent: true },
    ]);

    const result = await service.checkInitialized();
    expect(result).toBe(true);
  });

  it("should detect uninitialized repo", async () => {
    (backend.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("No git repository initialized"),
    );

    const result = await service.checkInitialized();
    expect(result).toBe(false);
  });
});
