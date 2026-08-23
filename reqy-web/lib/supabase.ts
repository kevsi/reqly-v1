/**
 * Supabase client configuration for server-side operations
 * Uses service role key for admin operations (capture session storage, cleanup)
 */

import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";

let supabaseClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  try {
    const env = getServerEnv();

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(
        "[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables. Using in-memory storage as fallback.",
      );
      return null;
    }

    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    return supabaseClient;
  } catch (error) {
    console.warn("[Supabase] Failed to initialize Supabase client:", error);
    return null;
  }
}

export async function initializeSupabase() {
  const client = getSupabaseClient();
  if (!client) {
    return false;
  }

  try {
    // Verify connection with a simple health check
    const { error } = await client.from("capture_sessions").select("count").limit(1);

    if (error) {
      console.warn("[Supabase] Health check failed. Table may not exist yet:", error.message);
      return false;
    }

    console.log("[Supabase] Connected successfully");
    return true;
  } catch (error) {
    console.warn("[Supabase] Health check error:", error);
    return false;
  }
}

/**
 * Migration SQL for capture_sessions table
 * Run this in Supabase SQL editor or via psql
 */
export const MIGRATION_SQL = `
-- Create capture_sessions table for persistent HTTP capture storage
CREATE TABLE IF NOT EXISTS capture_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Request details
  request_method TEXT NOT NULL,
  request_url TEXT NOT NULL,
  request_headers JSONB,
  request_body TEXT,
  
  -- Response details
  response_status INT NOT NULL,
  response_headers JSONB,
  response_body TEXT,
  
  -- Metadata
  duration_ms INT NOT NULL DEFAULT 0,
  size_bytes INT NOT NULL DEFAULT 0,
  
  -- Indexing
  created_at_idx TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS (created_at) STORED
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_capture_sessions_user_created ON capture_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capture_sessions_created_at ON capture_sessions(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE capture_sessions ENABLE ROW LEVEL SECURITY;

-- Supprimer l'ancienne politique qui donnait un accès complet à tous les rôles
-- (dont anon, qui expose toutes les sessions via la clé anon publique).
DROP POLICY IF EXISTS "Enable all operations for service role" ON capture_sessions;

-- Le service role (clé serveur) contourne RLS par BYPASSRLS — pas besoin de politique.
-- Les rôles anon et authenticated n'ont par défaut aucune politique → accès refusé.
-- Cette politique permet aux utilisateurs Supabase Auth de lire leurs propres sessions.
-- (L'application utilise son propre auth sync, pas Supabase Auth ; cette politique
--  est une sécurité supplémentaire si quelqu'un utilisait la clé anon.)
CREATE POLICY "Users read own sessions" ON capture_sessions
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);
CREATE POLICY "Users delete own sessions" ON capture_sessions
  FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);
`;
