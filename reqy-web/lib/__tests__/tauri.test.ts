import { describe, it, expect, vi, beforeEach } from "vitest";

describe("lib/tauri", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isTauriAvailable", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("returns false when window is undefined (SSR)", async () => {
      const origWindow = globalThis.window;
      delete (globalThis as unknown).window;
      const { isTauriAvailable } = await import("../tauri");
      expect(isTauriAvailable()).toBe(false);
      // Restore for other tests
      (globalThis as unknown).window = origWindow;
    });

    it("returns false when window has neither Tauri global", async () => {
      (globalThis as unknown).window = {};
      const { isTauriAvailable } = await import("../tauri");
      expect(isTauriAvailable()).toBe(false);
    });

    it("returns true when __TAURI_INTERNALS__ is present (Tauri v2)", async () => {
      (globalThis as unknown).window = { __TAURI_INTERNALS__: {} };
      const { isTauriAvailable } = await import("../tauri");
      expect(isTauriAvailable()).toBe(true);
    });

    it("returns true when __TAURI__ is present (Tauri v1 compat)", async () => {
      (globalThis as unknown).window = { __TAURI__: {} };
      const { isTauriAvailable } = await import("../tauri");
      expect(isTauriAvailable()).toBe(true);
    });
  });

  describe("invokeTauriFetch", () => {
    /** Shared mock for @tauri-apps/api/core */
    let mockInvoke: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.resetModules();
      mockInvoke = vi.fn();
      // Tauri must be available for invokeTauriFetch to proceed
      (globalThis as unknown).window = { __TAURI_INTERNALS__: {} };
    });

    it("throws when Tauri is not available", async () => {
      (globalThis as unknown).window = {};
      const { invokeTauriFetch } = await import("../tauri");
      await expect(invokeTauriFetch("GET", "http://example.com", {})).rejects.toThrow(
        "Tauri is not available",
      );
    });

    it("converts raw Vec<(String,String)> headers to Record<string,string>", async () => {
      mockInvoke.mockResolvedValue({
        status: 200,
        body: '{"ok":true}',
        headers: [
          ["content-type", "application/json"],
          ["x-request-id", "abc-123"],
        ],
        durationMs: 42,
        encoding: "utf8",
      });

      vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

      const { invokeTauriFetch } = await import("../tauri");
      const result = await invokeTauriFetch("GET", "http://example.com", {});

      expect(result.status).toBe(200);
      expect(result.body).toBe('{"ok":true}');
      expect(result.headers).toEqual({
        "content-type": "application/json",
        "x-request-id": "abc-123",
      });
      expect(result.durationMs).toBe(42);
      expect(result.encoding).toBe("utf8");
    });

    it("passes method, url, and serialised headers to invoke", async () => {
      mockInvoke.mockResolvedValue({
        status: 200,
        body: "",
        headers: [],
        durationMs: 0,
        encoding: "utf8",
      });

      vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

      const { invokeTauriFetch } = await import("../tauri");
      await invokeTauriFetch("POST", "https://api.example.com/data", {
        Authorization: "Bearer tok",
        "Content-Type": "application/json",
      });

      expect(mockInvoke).toHaveBeenCalledWith("fetch_proxy", {
        method: "POST",
        url: "https://api.example.com/data",
        headers: [
          ["Authorization", "Bearer tok"],
          ["Content-Type", "application/json"],
        ],
        body: undefined,
      });
    });

    it("passes body string when provided", async () => {
      mockInvoke.mockResolvedValue({
        status: 200,
        body: "",
        headers: [],
        durationMs: 0,
        encoding: "utf8",
      });

      vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

      const { invokeTauriFetch } = await import("../tauri");
      await invokeTauriFetch("POST", "https://api.example.com/data", {}, '{"key":"val"}');

      expect(mockInvoke).toHaveBeenCalledWith("fetch_proxy", {
        method: "POST",
        url: "https://api.example.com/data",
        headers: [],
        body: '{"key":"val"}',
      });
    });

    it("defaults encoding to utf8 when missing", async () => {
      mockInvoke.mockResolvedValue({
        status: 200,
        body: "hello",
        headers: [],
        durationMs: 10,
        encoding: undefined,
      });

      vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

      const { invokeTauriFetch } = await import("../tauri");
      const result = await invokeTauriFetch("GET", "http://example.com", {});
      expect(result.encoding).toBe("utf8");
    });

    it("defaults headers to empty record when null/undefined", async () => {
      mockInvoke.mockResolvedValue({
        status: 200,
        body: "test",
        headers: null,
        durationMs: 10,
        encoding: "utf8",
      });

      vi.doMock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

      const { invokeTauriFetch } = await import("../tauri");
      const result = await invokeTauriFetch("GET", "http://example.com", {});
      expect(result.headers).toEqual({});
    });
  });
});
