/**
 * Database abstraction layer for capture_sessions
 * Supports both Supabase (primary) and in-memory fallback storage
 */

import { getSupabaseClient } from "./supabase";
import type { CapturedSession } from "./capture-proxy";

interface StoredSession {
  id: string;
  user_id: string;
  created_at: string;
  request_method: string;
  request_url: string;
  request_headers: Record<string, string> | null;
  request_body: string | null;
  response_status: number;
  response_headers: Record<string, string> | null;
  response_body: string | null;
  duration_ms: number;
  size_bytes: number;
}

// Fallback in-memory storage (for when Supabase is not configured)
const inMemoryStorage = new Map<string, StoredSession>();

let inMemoryFallbackWarned = false;

/** Warn once, loudly, before the first in-memory fallback write/read. */
function warnInMemoryFallback(): void {
  if (inMemoryFallbackWarned) return;
  inMemoryFallbackWarned = true;
  console.warn(
    "[DB] Supabase is not configured — falling back to IN-MEMORY session " +
      "storage. All captured sessions will be LOST on restart.",
  );
}

function convertSessionToStored(
  session: CapturedSession,
  userId: string = "anonymous",
): StoredSession {
  return {
    id: session.id,
    user_id: userId,
    created_at: new Date(session.request.timestamp).toISOString(),
    request_method: session.request.method,
    request_url: session.request.url,
    request_headers: session.request.headers as Record<string, string> | null,
    request_body: session.request.body || null,
    response_status: session.response.statusCode,
    response_headers: session.response.headers as Record<string, string> | null,
    response_body: session.response.body || null,
    duration_ms: session.duration,
    size_bytes: session.size,
  };
}

function convertStoredToSession(stored: StoredSession): CapturedSession {
  return {
    id: stored.id,
    request: {
      id: stored.id,
      timestamp: new Date(stored.created_at).getTime(),
      method: stored.request_method,
      url: stored.request_url,
      headers: stored.request_headers || {},
      body: stored.request_body || "",
    },
    response: {
      statusCode: stored.response_status,
      statusMessage: "Captured",
      headers: stored.response_headers || {},
      body: stored.response_body || "",
    },
    duration: stored.duration_ms,
    size: stored.size_bytes,
  };
}

export async function insertCaptureSession(
  session: CapturedSession,
  userId?: string,
): Promise<boolean> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const stored = convertSessionToStored(session, userId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("capture_sessions") as any).insert([stored]);

      if (error) {
        console.error("[DB] Failed to insert session:", error);
        // Fall through to in-memory backup
      } else {
        return true;
      }
    } catch (error) {
      console.error("[DB] Exception inserting session:", error);
      // Fall through to in-memory backup
    }
  }

  // In-memory fallback
  warnInMemoryFallback();
  inMemoryStorage.set(session.id, convertSessionToStored(session, userId));
  return true;
}

export async function getCaptureSession(
  sessionId: string,
  userId?: string,
): Promise<CapturedSession | null> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      let query = supabase.from("capture_sessions").select("*").eq("id", sessionId);
      if (userId) query = query.eq("user_id", userId);
      const { data, error } = await query.single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows found (expected for missing sessions)
        console.error("[DB] Failed to fetch session:", error);
      } else if (data) {
        return convertStoredToSession(data);
      }
    } catch (error) {
      console.error("[DB] Exception fetching session:", error);
    }
  }

  // In-memory fallback
  warnInMemoryFallback();
  const stored = inMemoryStorage.get(sessionId);
  return stored && (!userId || stored.user_id === userId) ? convertStoredToSession(stored) : null;
}

export async function listCaptureSessions(
  limit: number = 100,
  offset: number = 0,
  userId?: string,
): Promise<CapturedSession[]> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      let query = supabase
        .from("capture_sessions")
        .select("*")
        .order("created_at", { ascending: false });
      if (userId) query = query.eq("user_id", userId);
      const { data, error } = await query.range(offset, offset + limit - 1);

      if (error) {
        console.error("[DB] Failed to list sessions:", error);
        // Fall through to in-memory
      } else if (data) {
        return data.map(convertStoredToSession);
      }
    } catch (error) {
      console.error("[DB] Exception listing sessions:", error);
    }
  }

  // In-memory fallback
  warnInMemoryFallback();
  return Array.from(inMemoryStorage.values())
    .filter((stored) => !userId || stored.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(offset, offset + limit)
    .map(convertStoredToSession);
}

export async function deleteCaptureSession(sessionId: string, userId?: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      // Vérifie d'abord l'existence/propriété (le DELETE ne renvoie pas de count)
      let checkQuery = supabase.from("capture_sessions").select("id").eq("id", sessionId);
      if (userId) checkQuery = checkQuery.eq("user_id", userId);
      const { data: existing } = await checkQuery.maybeSingle();
      if (!existing) return false;

      let query = supabase.from("capture_sessions").delete().eq("id", sessionId);
      if (userId) query = query.eq("user_id", userId);
      const { error } = await query;

      if (error) {
        console.error("[DB] Failed to delete session:", error);
        // Fall through to in-memory
      } else {
        return true;
      }
    } catch (error) {
      console.error("[DB] Exception deleting session:", error);
    }
  }

  // In-memory fallback
  warnInMemoryFallback();
  const stored = inMemoryStorage.get(sessionId);
  if (stored && (!userId || stored.user_id === userId)) {
    inMemoryStorage.delete(sessionId);
    return true;
  }
  return false;
}

export async function clearCapturesSessions(userId?: string): Promise<number> {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      let countQuery = supabase.from("capture_sessions").select("id", { count: "exact" });
      if (userId) countQuery = countQuery.eq("user_id", userId);
      const { data: countData } = await countQuery;

      const count = countData?.length || 0;

      let deleteQuery = supabase.from("capture_sessions").delete();
      deleteQuery = userId ? deleteQuery.eq("user_id", userId) : deleteQuery.neq("id", "");
      const { error } = await deleteQuery;

      if (error) {
        console.error("[DB] Failed to clear sessions:", error);
        // Fall through to in-memory
      } else {
        return count;
      }
    } catch (error) {
      console.error("[DB] Exception clearing sessions:", error);
    }
  }

  // In-memory fallback
  warnInMemoryFallback();
  const owned = Array.from(inMemoryStorage.entries()).filter(
    ([, stored]) => !userId || stored.user_id === userId,
  );
  const count = owned.length;
  for (const [id] of owned) inMemoryStorage.delete(id);
  return count;
}

export async function cleanupOldSessions(daysOld: number = 30): Promise<number> {
  const supabase = getSupabaseClient();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  if (supabase) {
    try {
      // Count before deletion
      const { data: countData } = await supabase
        .from("capture_sessions")
        .select("id", { count: "exact" })
        .lt("created_at", cutoffDate.toISOString());

      const count = countData?.length || 0;

      const { error } = await supabase
        .from("capture_sessions")
        .delete()
        .lt("created_at", cutoffDate.toISOString());

      if (error) {
        console.error("[DB] Failed to cleanup old sessions:", error);
        // Fall through to in-memory
      } else {
        console.log(`[DB] Cleaned up ${count} sessions older than ${daysOld} days`);
        return count;
      }
    } catch (error) {
      console.error("[DB] Exception cleaning up sessions:", error);
    }
  }

  // In-memory fallback
  warnInMemoryFallback();
  const cutoffTime = cutoffDate.getTime();
  let count = 0;

  for (const [id, session] of inMemoryStorage.entries()) {
    if (new Date(session.created_at).getTime() < cutoffTime) {
      inMemoryStorage.delete(id);
      count++;
    }
  }

  return count;
}

export function getSessionCount(): number {
  return inMemoryStorage.size;
}
