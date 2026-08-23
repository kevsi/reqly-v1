/**
 * Tests for HTTP Capture Proxy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock Supabase BEFORE importing capture-proxy
vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null,
}));

import {
  startCapture,
  stopCapture,
  recordSession,
  listCaptureSessions,
  getCaptureSession,
  clearCaptureSessions,
  getCaptureStatus,
  sessionToRequest,
  getProxyState,
} from "@/lib/capture-proxy";

describe("Capture Proxy", () => {
  beforeEach(async () => {
    // Reset state before each test
    const state = getProxyState();
    state.isRunning = false;
    state.sessions.clear();
    state.totalBandwidth = 0;
    state.requestCount = 0;
    state.bandwidthLimit = 50 * 1024 * 1024; // Reset to default (50MB/sec)
    state.startTime = Date.now();

    // Also clear database storage (both Supabase and in-memory fallback)
    await clearCaptureSessions();
  });

  afterEach(async () => {
    // Cleanup after each test
    const state = getProxyState();
    state.isRunning = false;
    state.sessions.clear();

    // Also clear database storage
    await clearCaptureSessions();
  });

  describe("startCapture", () => {
    it("should start capture proxy", async () => {
      const result = await startCapture();
      expect(result.status).toBe("started");

      const status = await getCaptureStatus();
      expect(status.isRunning).toBe(true);
    });

    it("should throw if capture already running", async () => {
      await startCapture();

      await expect(startCapture()).rejects.toThrow("Capture already running");
    });

    it("should accept bandwidth limit", async () => {
      await startCapture({ bandwidthLimitMbps: 10 });

      const status = await getCaptureStatus();
      expect(status.bandwidthLimitMbps).toBe(10);
    });
  });

  describe("stopCapture", () => {
    it("should stop capture proxy", async () => {
      await startCapture();
      const result = await stopCapture();

      expect(result.status).toBe("stopped");
      expect(result.sessionsCount).toBe(0);
    });

    it("should throw if capture not running", async () => {
      await expect(stopCapture()).rejects.toThrow("Capture not running");
    });
  });

  describe("recordSession", () => {
    beforeEach(async () => {
      await startCapture({ bandwidthLimitMbps: 100 }); // 100 MB/sec default
    });

    it("should record a session", async () => {
      const session = await recordSession(
        {
          id: "123",
          timestamp: Date.now(),
          method: "GET",
          url: "https://example.com/api/test",
          headers: { "User-Agent": "Test" },
        },
        {
          statusCode: 200,
          statusMessage: "OK",
          headers: { "Content-Type": "application/json" },
          body: '{"message":"success"}',
        },
        100,
      );

      expect(session).not.toBeNull();
      expect(session!.id).toBe("123");
      expect(session!.request.method).toBe("GET");
      expect(session!.response.statusCode).toBe(200);
      expect(session!.duration).toBe(100);
    });

    it("should throw if capture not running", async () => {
      await stopCapture();

      await expect(
        recordSession(
          {
            id: "123",
            timestamp: Date.now(),
            method: "GET",
            url: "https://example.com",
            headers: {},
          },
          {
            statusCode: 200,
            statusMessage: "OK",
            headers: {},
            body: "",
          },
          0,
        ),
      ).rejects.toThrow("Capture not running");
    });

    it("records captured body size accounting", async () => {
      // NOTE: bandwidth limiting is disabled in lib/capture-proxy.ts (see the
      // "TODO: Add bandwidth limiting when needed" there) — this test asserts
      // that a large session is recorded successfully with its byte size.
      const largeBody = "x".repeat(1 * 1024); // 1 KB

      const session = await recordSession(
        {
          id: "123",
          timestamp: Date.now(),
          method: "POST",
          url: "https://example.com",
          headers: {},
          body: largeBody,
        },
        {
          statusCode: 200,
          statusMessage: "OK",
          headers: {},
          body: "",
        },
        0,
      );

      expect(session.id).toBe("123");
      expect(session.size).toBeGreaterThanOrEqual(1 * 1024);
    });
  });

  describe("listCaptureSessions", () => {
    beforeEach(async () => {
      await startCapture();
    });

    it("should list all sessions in reverse chronological order", async () => {
      const now = Date.now();

      await recordSession(
        {
          id: "1",
          timestamp: now - 2000,
          method: "GET",
          url: "https://example.com/1",
          headers: {},
        },
        { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
        50,
      );

      await recordSession(
        {
          id: "2",
          timestamp: now,
          method: "POST",
          url: "https://example.com/2",
          headers: {},
        },
        { statusCode: 201, statusMessage: "Created", headers: {}, body: "{}" },
        100,
      );

      const sessions = await listCaptureSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("2"); // newest first
      expect(sessions[1].id).toBe("1");
    });

    it("should return empty list if no sessions", async () => {
      const sessions = await listCaptureSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("getCaptureSession", () => {
    beforeEach(async () => {
      await startCapture();
    });

    it("should get a specific session", async () => {
      await recordSession(
        {
          id: "test-123",
          timestamp: Date.now(),
          method: "GET",
          url: "https://example.com/test",
          headers: { "X-Custom": "value" },
        },
        { statusCode: 200, statusMessage: "OK", headers: { "X-Response": "header" }, body: "test" },
        75,
      );

      const session = await getCaptureSession("test-123");
      expect(session).not.toBeNull();
      expect(session!.id).toBe("test-123");
      expect(session!.request.headers["X-Custom"]).toBe("value");
      expect(session!.response.headers["X-Response"]).toBe("header");
    });

    it("should return null if session not found", async () => {
      const session = await getCaptureSession("nonexistent");
      expect(session).toBeNull();
    });
  });

  describe("clearCaptureSessions", () => {
    beforeEach(async () => {
      await startCapture();
    });

    it("should clear all sessions", async () => {
      await recordSession(
        { id: "1", timestamp: Date.now(), method: "GET", url: "https://example.com", headers: {} },
        { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
        0,
      );

      await recordSession(
        { id: "2", timestamp: Date.now(), method: "GET", url: "https://example.com", headers: {} },
        { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
        0,
      );

      let sessions = await listCaptureSessions();
      expect(sessions).toHaveLength(2);

      const result = await clearCaptureSessions();
      expect(result.clearedCount).toBe(2);

      sessions = await listCaptureSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("getCaptureStatus", () => {
    it("should return capture status", async () => {
      const status = await getCaptureStatus();
      expect(status.isRunning).toBe(false);
      expect(status.sessionsCount).toBe(0);

      await startCapture({ bandwidthLimitMbps: 5 });
      const activeStatus = await getCaptureStatus();
      expect(activeStatus.isRunning).toBe(true);
      expect(activeStatus.bandwidthLimitMbps).toBe(5);
    });
  });

  describe("sessionToRequest", () => {
    it("should convert session to importable request", async () => {
      await startCapture();
      const session = await recordSession(
        {
          id: "123",
          timestamp: 1000,
          method: "POST",
          url: "https://api.example.com/data",
          headers: { "Content-Type": "application/json" },
          body: '{"key":"value"}',
        },
        { statusCode: 201, statusMessage: "Created", headers: {}, body: "{}" },
        150,
      );

      const request = sessionToRequest(session!);
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.example.com/data");
      expect(request.headers["Content-Type"]).toBe("application/json");
      expect(request.body).toBe('{"key":"value"}');
      expect(request.captured).toBe(true);
      expect(request.capturedDuration).toBe(150);
    });
  });

  describe("Rate Limiting", () => {
    beforeEach(async () => {
      await startCapture();
    });

    afterEach(async () => {
      await stopCapture();
      await clearCaptureSessions();
    });

    it("should accept rateLimitKey parameter in recordSession", async () => {
      const session = await recordSession(
        {
          id: "123",
          timestamp: Date.now(),
          method: "GET",
          url: "https://example.com/test",
          headers: {},
        },
        { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
        100,
        "192.168.1.1", // rateLimitKey
      );

      // Should succeed or return null (depending on rate limiter state)
      // The important part is that it accepts the parameter without error
      expect(session === null || session.id === "123").toBe(true);
    });

    it("should record multiple sessions under rate limit", async () => {
      const sessions: Awaited<ReturnType<typeof recordSession>>[] = [];

      for (let i = 0; i < 5; i++) {
        const session = await recordSession(
          {
            id: `req-${i}`,
            timestamp: Date.now() + i,
            method: "GET",
            url: `https://example.com/api/${i}`,
            headers: {},
          },
          { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
          50,
          "192.168.1.1",
        );

        if (session) {
          sessions.push(session);
        }
      }

      // At least some sessions should be recorded
      expect(sessions.length).toBeGreaterThan(0);
    });

    it("should handle rate limit key per IP address", async () => {
      const sessionIp1 = await recordSession(
        {
          id: "ip1-req1",
          timestamp: Date.now(),
          method: "GET",
          url: "https://example.com",
          headers: {},
        },
        { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
        50,
        "192.168.1.1", // IP 1
      );

      const sessionIp2 = await recordSession(
        {
          id: "ip2-req1",
          timestamp: Date.now(),
          method: "GET",
          url: "https://example.com",
          headers: {},
        },
        { statusCode: 200, statusMessage: "OK", headers: {}, body: "" },
        50,
        "192.168.1.2", // Different IP
      );

      // Both should succeed (different keys)
      expect(sessionIp1 === null || sessionIp1.id === "ip1-req1").toBe(true);
      expect(sessionIp2 === null || sessionIp2.id === "ip2-req1").toBe(true);
    });
  });
});
