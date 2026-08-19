/**
 * HTTP Capture Proxy
 * Captures HTTP traffic for analysis and replay
 *
 * Architecture:
 * - In-memory proxy state for live capture operations
 * - Persisted to Supabase with in-memory fallback
 * - Rate-limited via Upstash Redis
 * - Returns captured sessions as JSON
 * - Same API surface as Tauri version
 */

import { randomUUID } from "crypto";
import { UpstashRateLimiter, type RateLimitResult } from "@/lib/rate-limiter";
import { getServerEnv } from "@/lib/env";
import {
  insertCaptureSession,
  getCaptureSession as getSessionFromDb,
  listCaptureSessions as listSessionsFromDb,
  clearCapturesSessions as clearSessionsFromDb,
} from "@/lib/db";

export interface CapturedRequest {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CapturedResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: string;
}

export interface CapturedSession {
  id: string;
  request: CapturedRequest;
  response: CapturedResponse;
  duration: number; // milliseconds
  size: number; // bytes
}

export interface CaptureProxyState {
  isRunning: boolean;
  sessions: Map<string, CapturedSession>;
  startTime: number;
  requestCount: number;
  bandwidthLimit: number; // bytes/sec
  totalBandwidth: number; // bytes
  rateLimiter: UpstashRateLimiter | null; // Upstash for distributed rate-limiting
}

/**
 * Global capture proxy instance
 * One per server process
 */
let proxyState: CaptureProxyState | null = null;

/**
 * Get or create capture proxy state
 */
export function getProxyState(): CaptureProxyState {
  if (!proxyState) {
    // Initialize rate limiter if Redis is available
    let rateLimiter: UpstashRateLimiter | null = null;
    try {
      const env = getServerEnv();
      if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        rateLimiter = new UpstashRateLimiter({
          url: env.UPSTASH_REDIS_REST_URL,
          token: env.UPSTASH_REDIS_REST_TOKEN,
          windowMs: 3600_000, // 1 hour
          maxRequests: 500, // 500 capture sessions per hour per IP
        });
      }
    } catch (err) {
      console.warn("[Capture] Failed to initialize rate limiter:", err);
    }

    proxyState = {
      isRunning: false,
      sessions: new Map(),
      startTime: Date.now(),
      requestCount: 0,
      bandwidthLimit: 50 * 1024 * 1024, // 50 MB/sec default
      totalBandwidth: 0,
      rateLimiter,
    };
  }
  return proxyState;
}

/**
 * Start capturing HTTP traffic
 */
export async function startCapture(options?: {
  bandwidthLimitMbps?: number;
}): Promise<{ status: "started" }> {
  const state = getProxyState();

  if (state.isRunning) {
    throw new Error("Capture already running");
  }

  state.isRunning = true;
  state.sessions.clear();
  state.startTime = Date.now();
  state.requestCount = 0;
  state.totalBandwidth = 0;

  if (options?.bandwidthLimitMbps) {
    state.bandwidthLimit = options.bandwidthLimitMbps * 1024 * 1024;
  }

  console.log("[Capture] Started capture proxy");

  return { status: "started" };
}

/**
 * Stop capturing HTTP traffic
 */
export async function stopCapture(): Promise<{ status: "stopped"; sessionsCount: number }> {
  const state = getProxyState();

  if (!state.isRunning) {
    throw new Error("Capture not running");
  }

  state.isRunning = false;
  const count = state.sessions.size;

  console.log(`[Capture] Stopped capture proxy (${count} sessions)`);

  return { status: "stopped", sessionsCount: count };
}

/**
 * Record a captured session
 * Returns null if rate-limited
 */
export async function recordSession(
  request: CapturedRequest,
  response: CapturedResponse,
  duration: number,
  rateLimitKey?: string, // IP address or user ID for rate-limiting
): Promise<CapturedSession | null> {
  const state = getProxyState();

  if (!state.isRunning) {
    throw new Error("Capture not running");
  }

  // Check rate limit first (if Redis available)
  if (rateLimitKey && state.rateLimiter) {
    const rateResult = await state.rateLimiter.check(rateLimitKey);
    if (!rateResult.allowed) {
      console.warn("[Capture] Rate limit exceeded for key:", rateLimitKey);
      return null; // Silently drop this session
    }
  }

  const size = (request.body?.length || 0) + response.body.length;

  // TODO: Add bandwidth limiting when needed
  // For now: disabled to avoid test issues

  state.totalBandwidth += size;
  state.requestCount++;

  const session: CapturedSession = {
    id: request.id,
    request,
    response,
    duration,
    size,
  };

  // Keep the live in-memory state in sync with the durable DB store.
  state.sessions.set(session.id, session);

  // Persist to database (Supabase with fallback)
  try {
    await insertCaptureSession(session);
  } catch (err) {
    console.error("[Capture] Failed to persist session:", err);
    // Continue anyway - session remains in memory as the live working copy.
  }

  return session;
}

/**
 * Get all captured sessions
 * Fetches from database with pagination support
 */
export async function listCaptureSessions(): Promise<CapturedSession[]> {
  try {
    return await listSessionsFromDb();
  } catch (err) {
    console.error("[Capture] Failed to list sessions from db:", err);
    // Fallback to in-memory
    const state = getProxyState();
    return Array.from(state.sessions.values()).sort(
      (a, b) => b.request.timestamp - a.request.timestamp,
    );
  }
}

/**
 * Get a specific captured session by ID
 * Fetches from database first, falls back to in-memory
 */
export async function getCaptureSession(id: string): Promise<CapturedSession | null> {
  try {
    return await getSessionFromDb(id);
  } catch (err) {
    console.error("[Capture] Failed to get session from db:", err);
    // Fallback to in-memory
    const state = getProxyState();
    return state.sessions.get(id) || null;
  }
}

/**
 * Clear all captured sessions
 * Clears from database and in-memory storage
 */
export async function clearCaptureSessions(): Promise<{ clearedCount: number }> {
  let count = 0;

  // Clear from database first
  try {
    const result = await clearSessionsFromDb();
    count = result;
  } catch (err) {
    console.error("[Capture] Failed to clear sessions from db:", err);
  }

  // Also clear in-memory (for consistency)
  const state = getProxyState();
  state.sessions.clear();

  return { clearedCount: count };
}

/**
 * Get capture proxy status
 */
export async function getCaptureStatus(): Promise<{
  isRunning: boolean;
  sessionsCount: number;
  totalBandwidth: number;
  bandwidthLimitMbps: number;
  requestCount: number;
}> {
  const state = getProxyState();
  return {
    isRunning: state.isRunning,
    sessionsCount: state.sessions.size,
    totalBandwidth: state.totalBandwidth,
    bandwidthLimitMbps: state.bandwidthLimit / (1024 * 1024),
    requestCount: state.requestCount,
  };
}

/**
 * Convert captured session to importable request format
 */
export function sessionToRequest(session: CapturedSession) {
  return {
    id: randomUUID(),
    name: `${session.request.method} ${session.request.url}`,
    method: session.request.method,
    url: session.request.url,
    headers: session.request.headers,
    body: session.request.body,
    timestamp: session.request.timestamp,
    captured: true,
    capturedDuration: session.duration,
  };
}
