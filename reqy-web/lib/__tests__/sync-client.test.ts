import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollSyncChanges, pushChanges, pollAllSyncChanges } from "@/lib/sync-client";

describe("sync-client", () => {
  const mockFetch = vi.fn();
  const baseConfig = {
    baseUrl: "https://sync.example.com",
    token: "test-token",
    fetcher: mockFetch,
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("pollSyncChanges", () => {
    it("builds correct URL with workspaceId and since", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          changes: [],
          nextCursor: null,
          hasMore: false,
          serverTime: Date.now(),
        }),
      });

      await pollSyncChanges({ workspaceId: "ws-123", since: 1000 }, baseConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://sync.example.com/api/sync/poll?workspaceId=ws-123&since=1000",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/json",
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("includes limit and cursor when provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          changes: [],
          nextCursor: null,
          hasMore: false,
          serverTime: Date.now(),
        }),
      });

      await pollSyncChanges(
        { workspaceId: "ws-123", since: 1000, limit: 50, cursor: "cursor-abc" },
        baseConfig,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://sync.example.com/api/sync/poll?workspaceId=ws-123&since=1000&limit=50&cursor=cursor-abc",
        expect.anything(),
      );
    });

    it("throws when baseUrl missing and env not configured", async () => {
      const configNoUrl = { ...baseConfig, baseUrl: undefined };
      vi.stubGlobal("process", { env: {} });

      await expect(pollSyncChanges({ workspaceId: "ws-123" }, configNoUrl)).rejects.toThrow(
        "NEXT_PUBLIC_SYNC_URL is not configured",
      );
    });

    it("throws on non-ok response with error body", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      await expect(pollSyncChanges({ workspaceId: "ws-123" }, baseConfig)).rejects.toThrow(
        "Unauthorized",
      );
    });

    it("throws on non-ok response without error body", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(pollSyncChanges({ workspaceId: "ws-123" }, baseConfig)).rejects.toThrow(
        "Sync poll failed: 500",
      );
    });

    it("returns parsed page on success", async () => {
      const mockPage = {
        changes: [
          {
            entityType: "collection" as const,
            id: "c1",
            data: {},
            updatedAt: 123,
            updatedBy: "user",
            version: 1,
            deleted: false,
          },
        ],
        nextCursor: "next-cursor",
        hasMore: true,
        serverTime: Date.now(),
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPage,
      });

      const result = await pollSyncChanges({ workspaceId: "ws-123" }, baseConfig);
      expect(result).toEqual(mockPage);
    });
  });

  describe("pushChanges", () => {
    it("sends POST with changes to /api/sync/push", async () => {
      const changes = [
        {
          entityType: "collection" as const,
          id: "c1",
          data: { name: "test" },
          updatedAt: 123,
          updatedBy: "user",
        },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accepted: ["c1"], conflicts: [] }),
      });

      const result = await pushChanges("ws-123", changes, baseConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://sync.example.com/api/sync/push",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
          }),
          body: JSON.stringify({ workspaceId: "ws-123", changes }),
        }),
      );
      expect(result).toEqual({ accepted: ["c1"], conflicts: [] });
    });

    it("throws when baseUrl missing", async () => {
      vi.stubGlobal("process", { env: {} });
      const configNoUrl = { ...baseConfig, baseUrl: undefined };

      await expect(pushChanges("ws-123", [], configNoUrl)).rejects.toThrow(
        "NEXT_PUBLIC_SYNC_URL is not configured",
      );
    });

    it("throws on push failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "Conflict" }),
      });

      await expect(pushChanges("ws-123", [], baseConfig)).rejects.toThrow("Conflict");
    });
  });

  describe("pollAllSyncChanges", () => {
    it("yields all changes across pages", async () => {
      const page1 = {
        changes: [
          {
            entityType: "collection" as const,
            id: "c1",
            data: {},
            updatedAt: 1,
            updatedBy: "u",
            version: 1,
            deleted: false,
          },
          {
            entityType: "folder" as const,
            id: "f1",
            data: {},
            updatedAt: 2,
            updatedBy: "u",
            version: 1,
            deleted: false,
          },
        ],
        nextCursor: "cursor-2",
        hasMore: true,
        serverTime: Date.now(),
      };
      const page2 = {
        changes: [
          {
            entityType: "environment" as const,
            id: "e1",
            data: {},
            updatedAt: 3,
            updatedBy: "u",
            version: 1,
            deleted: false,
          },
        ],
        nextCursor: null,
        hasMore: false,
        serverTime: Date.now(),
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => page1 })
        .mockResolvedValueOnce({ ok: true, json: async () => page2 });

      const results = [];
      for await (const change of pollAllSyncChanges(
        { workspaceId: "ws-123", since: 0 },
        baseConfig,
      )) {
        results.push(change);
      }

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.id)).toEqual(["c1", "f1", "e1"]);
    });

    it("calls onPage callback for each page", async () => {
      const page1 = { changes: [], nextCursor: "c2", hasMore: true, serverTime: Date.now() };
      const page2 = { changes: [], nextCursor: null, hasMore: false, serverTime: Date.now() };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => page1 })
        .mockResolvedValueOnce({ ok: true, json: async () => page2 });

      const onPage = vi.fn();
      for await (const _ of pollAllSyncChanges({ workspaceId: "ws-123" }, baseConfig, onPage)) {
        // Consume the async generator so all pages are fetched.
      }

      expect(onPage).toHaveBeenCalledTimes(2);
      expect(onPage).toHaveBeenNthCalledWith(1, page1);
      expect(onPage).toHaveBeenNthCalledWith(2, page2);
    });

    it("stops when cursor is null", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          changes: [],
          nextCursor: null,
          hasMore: false,
          serverTime: Date.now(),
        }),
      });

      let count = 0;
      for await (const _ of pollAllSyncChanges({ workspaceId: "ws-123" }, baseConfig)) {
        count++;
      }
      expect(count).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
