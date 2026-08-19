import { beforeEach, describe, expect, it, vi } from "vitest";

const { pollAllSyncChanges, pushChanges, connectSyncWs, cursorLoad, cursorSave } = vi.hoisted(
  () => ({
    pollAllSyncChanges: vi.fn(),
    pushChanges: vi.fn(),
    connectSyncWs: vi.fn(() => ({
      disconnect: vi.fn(),
      isConnected: () => false,
    })),
    cursorLoad: vi.fn(() => ({})),
    cursorSave: vi.fn(),
  }),
);

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SYNC_URL: "https://sync.example.com" }),
}));
vi.mock("@/lib/sync-client", () => ({
  pollAllSyncChanges,
  pushChanges,
}));
vi.mock("@/lib/sync/sync-ws", () => ({ connectSyncWs }));
vi.mock("@/lib/session-store", () => ({
  useSessionStore: { getState: () => ({ token: "signed-session-token" }) },
}));
vi.mock("@/hooks/store/persistence", () => ({
  syncCursors: { load: cursorLoad, save: cursorSave },
}));

import { createSyncEngine } from "@/hooks/store/sync";
import type { RequestStore } from "@/hooks/request-types";

function makeStore(): RequestStore {
  return {
    collections: [],
    environments: [],
    workspaces: [
      {
        id: "ws-real",
        name: "Workspace",
        ownerId: "user-1",
        role: "owner",
        color: "blue",
        icon: "folder",
        description: "",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeWorkspaceId: "ws-real",
  } as unknown as RequestStore;
}

describe("sync engine authentication wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cursorLoad.mockReturnValue({});
    pollAllSyncChanges.mockImplementation(async function* () {});
    pushChanges.mockResolvedValue({ accepted: [], conflicts: [] });
  });

  it("passes the session token to pull and WebSocket", async () => {
    const state = makeStore();
    const engine = createSyncEngine({
      get: () => state,
      commit: vi.fn(),
    });

    await engine.pullWorkspace("ws-real");
    engine.connectWebSocket("ws-real");

    expect(pollAllSyncChanges).toHaveBeenCalledWith(
      { workspaceId: "ws-real", since: 0 },
      { token: "signed-session-token" },
      expect.any(Function),
    );
    expect(connectSyncWs).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-real",
        syncUrl: "https://sync.example.com",
        token: "signed-session-token",
      }),
    );
  });

  it("passes the session token to a debounced push", async () => {
    const state = makeStore();
    state.collections = [
      {
        id: "c1",
        name: "Collection",
        workspaceId: "ws-real",
        requests: [],
        folders: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ] as never;
    const engine = createSyncEngine({
      get: () => state,
      commit: vi.fn(),
    });

    engine.schedulePush("ws-real");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(pushChanges).toHaveBeenCalledWith(
      "ws-real",
      expect.arrayContaining([expect.objectContaining({ entityType: "collection", id: "c1" })]),
      { token: "signed-session-token" },
    );
  });
});
