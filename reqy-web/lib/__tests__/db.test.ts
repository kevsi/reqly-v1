/**
 * Database layer integration tests
 * Tests Supabase fallback to in-memory storage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  insertCaptureSession,
  getCaptureSession,
  listCaptureSessions,
  deleteCaptureSession,
  clearCapturesSessions,
  cleanupOldSessions,
  getSessionCount,
} from "@/lib/db";
import type { CapturedSession } from "@/lib/capture-proxy";

// Mock Supabase to always return null (use in-memory fallback)
vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null,
}));

function createMockSession(id: string, ageMinutes: number = 0): CapturedSession {
  const timestamp = Date.now() - ageMinutes * 60000;
  return {
    id,
    request: {
      id,
      timestamp,
      method: "GET",
      url: `https://example.com/api/${id}`,
      headers: { "User-Agent": "Test" },
      body: "",
    },
    response: {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "Content-Type": "application/json" },
      body: '{"success":true}',
    },
    duration: 100,
    size: 256,
  };
}

describe("Database Layer", () => {
  beforeEach(async () => {
    await clearCapturesSessions();
  });

  describe("insertCaptureSession", () => {
    it("should insert a session", async () => {
      const session = createMockSession("test-1");
      const result = await insertCaptureSession(session);

      expect(result).toBe(true);
      expect(getSessionCount()).toBe(1);
    });

    it("should insert multiple sessions", async () => {
      for (let i = 0; i < 5; i++) {
        const session = createMockSession(`test-${i}`);
        const result = await insertCaptureSession(session);
        expect(result).toBe(true);
      }

      expect(getSessionCount()).toBe(5);
    });

    it("should accept optional userId parameter", async () => {
      const session = createMockSession("test-user");
      const result = await insertCaptureSession(session, "user-123");

      expect(result).toBe(true);
      expect(getSessionCount()).toBe(1);
    });
  });

  describe("getCaptureSession", () => {
    it("should retrieve a session by ID", async () => {
      const original = createMockSession("test-1");
      await insertCaptureSession(original);

      const retrieved = await getCaptureSession("test-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("test-1");
      expect(retrieved!.request.method).toBe("GET");
      expect(retrieved!.response.statusCode).toBe(200);
    });

    it("should return null for non-existent session", async () => {
      const result = await getCaptureSession("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("listCaptureSessions", () => {
    it("should list all sessions in reverse chronological order", async () => {
      const now = Date.now();

      for (let i = 0; i < 3; i++) {
        const session = createMockSession(`test-${i}`, i * 10);
        await insertCaptureSession(session);
      }

      const sessions = await listCaptureSessions();

      expect(sessions).toHaveLength(3);
      // Most recent first
      expect(sessions[0].id).toBe("test-0");
      expect(sessions[1].id).toBe("test-1");
      expect(sessions[2].id).toBe("test-2");
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await insertCaptureSession(createMockSession(`test-${i}`));
      }

      const sessions = await listCaptureSessions(5);
      expect(sessions).toHaveLength(5);
    });

    it("should support pagination with offset", async () => {
      for (let i = 0; i < 10; i++) {
        await insertCaptureSession(createMockSession(`test-${i}`));
      }

      const firstPage = await listCaptureSessions(5, 0);
      const secondPage = await listCaptureSessions(5, 5);

      expect(firstPage).toHaveLength(5);
      expect(secondPage).toHaveLength(5);
      expect(firstPage[0].id).not.toBe(secondPage[0].id);
    });

    it("should return empty array when no sessions", async () => {
      const sessions = await listCaptureSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("deleteCaptureSession", () => {
    it("should delete a session by ID", async () => {
      const session = createMockSession("test-delete");
      await insertCaptureSession(session);
      expect(getSessionCount()).toBe(1);

      const result = await deleteCaptureSession("test-delete");

      expect(result).toBe(true);
      expect(getSessionCount()).toBe(0);
      expect(await getCaptureSession("test-delete")).toBeNull();
    });

    it("should handle deletion of non-existent session", async () => {
      const result = await deleteCaptureSession("non-existent");
      expect(result).toBe(true); // Should not throw
    });
  });

  describe("clearCapturesSessions", () => {
    it("should clear all sessions", async () => {
      for (let i = 0; i < 5; i++) {
        await insertCaptureSession(createMockSession(`test-${i}`));
      }

      expect(getSessionCount()).toBe(5);

      const clearedCount = await clearCapturesSessions();

      expect(clearedCount).toBe(5);
      expect(getSessionCount()).toBe(0);
    });

    it("should return 0 when clearing empty storage", async () => {
      const clearedCount = await clearCapturesSessions();
      expect(clearedCount).toBe(0);
    });
  });

  describe("cleanupOldSessions", () => {
    it("should delete sessions older than specified days", async () => {
      // Add old session (40 days old)
      const oldSession = createMockSession("test-old", 40 * 24 * 60);
      await insertCaptureSession(oldSession);

      // Add new session (10 days old)
      const newSession = createMockSession("test-new", 10 * 24 * 60);
      await insertCaptureSession(newSession);

      expect(getSessionCount()).toBe(2);

      const clearedCount = await cleanupOldSessions(30);

      expect(clearedCount).toBe(1);
      expect(getSessionCount()).toBe(1);
      expect(await getCaptureSession("test-new")).not.toBeNull();
      expect(await getCaptureSession("test-old")).toBeNull();
    });

    it("should not delete recent sessions", async () => {
      for (let i = 0; i < 5; i++) {
        const session = createMockSession(`test-recent-${i}`, 5); // 5 minutes old
        await insertCaptureSession(session);
      }

      const clearedCount = await cleanupOldSessions(30);

      expect(clearedCount).toBe(0);
      expect(getSessionCount()).toBe(5);
    });

    it("should return cleanup count", async () => {
      for (let i = 0; i < 3; i++) {
        const session = createMockSession(`test-old-${i}`, 31 * 24 * 60);
        await insertCaptureSession(session);
      }

      const clearedCount = await cleanupOldSessions(30);

      expect(clearedCount).toBe(3);
    });
  });

  describe("Session conversion", () => {
    it("should preserve session data through insert/retrieve cycle", async () => {
      const original = createMockSession("test-preserve");
      original.request.headers = { "X-Custom": "value", Authorization: "Bearer token" };
      original.response.headers = { "X-Response": "header-value" };

      await insertCaptureSession(original);
      const retrieved = await getCaptureSession("test-preserve");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.request.url).toBe(original.request.url);
      expect(retrieved!.request.headers).toEqual(original.request.headers);
      expect(retrieved!.response.statusCode).toBe(original.response.statusCode);
      expect(retrieved!.response.headers).toEqual(original.response.headers);
      expect(retrieved!.duration).toBe(original.duration);
      expect(retrieved!.size).toBe(original.size);
    });
  });
});
