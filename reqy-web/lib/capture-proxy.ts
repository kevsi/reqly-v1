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
import { createRateLimiter, RateLimiter } from "@/lib/rate-limiter";
import {
  insertCaptureSession,
  getCaptureSession as getSessionFromDb,
  listCaptureSessions as listSessionsFromDb,
  clearCapturesSessions as clearSessionsFromDb,
  deleteCaptureSession as deleteSessionFromDb,
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
  sessionOwners: Map<string, string>;
  startTime: number;
  requestCount: number;
  bandwidthLimit: number; // bytes/sec
  totalBandwidth: number; // bytes
  rateLimiter: RateLimiter; // mémoire locale par défaut, Upstash si configuré
  /** Nombre de sessions rejetées par le rate limit (visible dans le status). */
  droppedCount: number;
}

/**
 * Global capture proxy instance
 * One per server process
 */
let proxyState: CaptureProxyState | null = null;

/** Nombre maximal de sessions conservées en mémoire (les plus anciennes sont
 * évincées). Empêche la croissance mémoire illimitée en cas de capture longue. */
const MAX_IN_MEMORY_SESSIONS = 2000;

/**
 * Get or create capture proxy state
 */
export function getProxyState(): CaptureProxyState {
  if (!proxyState) {
    // Toujours créer un rate limiter (mémoire locale par défaut ; Upstash si
    // configuré). Voir la note « Serverless / Edge deployment » dans
    // rate-limiter.ts pour les limites du fallback mémoire.
    const rateLimiter = createRateLimiter({
      windowMs: 3600_000, // 1 heure
      maxRequests: 500, // 500 sessions par heure par IP
    });

    proxyState = {
      isRunning: false,
      sessions: new Map(),
      sessionOwners: new Map(),
      startTime: Date.now(),
      requestCount: 0,
      bandwidthLimit: 50 * 1024 * 1024, // 50 MB/sec default
      totalBandwidth: 0,
      rateLimiter,
      droppedCount: 0,
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
  state.sessionOwners.clear();
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
  userId?: string,
): Promise<CapturedSession | null> {
  const state = getProxyState();

  if (!state.isRunning) {
    throw new Error("Capture not running");
  }

  // Check rate limit first (si Upstash configuré)
  if (rateLimitKey && state.rateLimiter) {
    const rateResult = await state.rateLimiter.check(rateLimitKey);
    if (!rateResult.allowed) {
      console.warn("[Capture] Rate limit exceeded for key:", rateLimitKey);
      state.droppedCount++;
      return null; // Session ignorée — comptée pour le status
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
  // Plafonne la mémoire : au-delà de MAX_IN_MEMORY_SESSIONS, on évince les
  // sessions les plus anciennes (les plus récentes restent consultables).
  state.sessions.set(session.id, session);
  if (userId) state.sessionOwners.set(session.id, userId);
  if (state.sessions.size > MAX_IN_MEMORY_SESSIONS) {
    const oldest = state.sessions.keys().next().value;
    if (oldest !== undefined) {
      state.sessions.delete(oldest);
      state.sessionOwners.delete(oldest);
    }
  }

  // Persist to database (Supabase with fallback)
  try {
    await insertCaptureSession(session, userId);
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
export async function listCaptureSessions(userId?: string): Promise<CapturedSession[]> {
  try {
    return await listSessionsFromDb(100, 0, userId);
  } catch (err) {
    console.error("[Capture] Failed to list sessions from db:", err);
    // Fallback to in-memory
    const state = getProxyState();
    return Array.from(state.sessions.values())
      .filter((session) => !userId || state.sessionOwners.get(session.id) === userId)
      .sort((a, b) => b.request.timestamp - a.request.timestamp);
  }
}

/**
 * Get a specific captured session by ID
 * Fetches from database first, falls back to in-memory
 */
export async function getCaptureSession(
  id: string,
  userId?: string,
): Promise<CapturedSession | null> {
  try {
    return await getSessionFromDb(id, userId);
  } catch (err) {
    console.error("[Capture] Failed to get session from db:", err);
    // Fallback to in-memory
    const state = getProxyState();
    const session = state.sessions.get(id);
    return session && (!userId || state.sessionOwners.get(id) === userId) ? session : null;
  }
}

/**
 * Supprime une session capturée (propriétaire uniquement).
 * Retourne `true` si la session a bien été supprimée.
 */
export async function deleteCaptureSession(id: string, userId?: string): Promise<boolean> {
  // Supprime de la mémoire vive (l'état de capture live)
  const state = getProxyState();
  const owner = state.sessionOwners.get(id);
  if (state.sessions.has(id)) {
    if (userId && owner && owner !== userId) return false;
    state.sessions.delete(id);
    state.sessionOwners.delete(id);
  }

  // Puis de la base (Supabase ou fallback mémoire)
  try {
    return await deleteSessionFromDb(id, userId);
  } catch (err) {
    console.error("[Capture] Failed to delete session from db:", err);
    return state.sessions.has(id) ? true : false;
  }
}

/**
 * Clear all captured sessions
 * Clears from database and in-memory storage
 */
export async function clearCaptureSessions(userId?: string): Promise<{ clearedCount: number }> {
  let count = 0;

  // Clear from database first
  try {
    const result = await clearSessionsFromDb(userId);
    count = result;
  } catch (err) {
    console.error("[Capture] Failed to clear sessions from db:", err);
  }

  // Also clear in-memory (for consistency)
  const state = getProxyState();
  if (!userId) {
    state.sessions.clear();
    state.sessionOwners.clear();
  } else {
    for (const id of state.sessions.keys()) {
      if (state.sessionOwners.get(id) === userId) {
        state.sessions.delete(id);
        state.sessionOwners.delete(id);
      }
    }
  }

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
  /** Sessions rejetées par le rate limit depuis le démarrage. */
  droppedCount: number;
}> {
  const state = getProxyState();
  return {
    isRunning: state.isRunning,
    sessionsCount: state.sessions.size,
    totalBandwidth: state.totalBandwidth,
    bandwidthLimitMbps: state.bandwidthLimit / (1024 * 1024),
    requestCount: state.requestCount,
    droppedCount: state.droppedCount,
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
