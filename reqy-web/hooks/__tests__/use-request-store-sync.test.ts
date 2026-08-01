import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SYNC_URL: "http://localhost:4000" }),
}));

vi.mock("@/lib/sync-client", () => ({
  pollAllSyncChanges: vi.fn(),
}));

import { pollAllSyncChanges } from "@/lib/sync-client";
import { requestStore } from "@/hooks/use-request-store";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";

const colChange = {
  entityType: "collection" as const,
  id: "c-remote",
  data: {
    id: "c-remote",
    name: "Remote",
    workspaceId: "ws-real",
    requests: [],
    createdAt: 1,
    updatedAt: 1,
  },
  updatedAt: 1,
  updatedBy: "u",
  version: 1,
  deleted: false,
};

describe("store sync wiring (pull)", () => {
  beforeEach(() => {
    requestStore.getState().reset();
    if (typeof localStorage !== "undefined") localStorage.clear();
    vi.mocked(pollAllSyncChanges).mockReset();
    vi.mocked(pollAllSyncChanges).mockImplementation(async function* () {
      yield colChange;
    });
  });

  it("pullWorkspace merges remote changes into the store", async () => {
    const res = await requestStore.getState().pullWorkspace("ws-real");
    expect(res.applied).toBe(1);
    expect(requestStore.getState().collections.some((c) => c.id === "c-remote")).toBe(true);
  });

  it("does not pull for the personal workspace", async () => {
    const res = await requestStore.getState().pullWorkspace(WORKSPACE_PERSONAL_ID);
    expect(res.applied).toBe(0);
    expect(pollAllSyncChanges).not.toHaveBeenCalled();
  });

  it("pulls on workspace switch via the store subscription", async () => {
    requestStore.setState({ activeWorkspaceId: "ws-real" });
    await new Promise((r) => setTimeout(r, 50));
    expect(pollAllSyncChanges).toHaveBeenCalled();
    expect(requestStore.getState().collections.some((c) => c.id === "c-remote")).toBe(true);
  });

  it("pulls the active workspace during initStore", async () => {
    requestStore.setState({ activeWorkspaceId: "ws-real" });
    await requestStore.getState().initStore();
    expect(requestStore.getState().collections.some((c) => c.id === "c-remote")).toBe(true);
  });
});
