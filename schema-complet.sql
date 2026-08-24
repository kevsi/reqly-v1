-- ═══════════════════════════════════════════════════════════════════════════
-- REQLY — SCHÉMA COMPLET DE LA BASE DE DONNÉES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le projet utilise DEUX bases distinctes :
--
--  1) Sync server  → SQLite (better-sqlite3), fichier data/reqly-sync.db
--     Tables : users, workspaces, memberships, invitations, collections,
--              environments, folders, hooklet_endpoints, hooklet_events,
--              hooklet_devices
--     Source : sync-server/src/db.ts
--
--  2) Supabase (web) → PostgreSQL (capture HTTP persistante)
--     Table : capture_sessions
--     Source : reqy-web/lib/supabase.ts (MIGRATION_SQL)
--
-- Légende des types :
--   - SQLite : INTEGER = booléen (0/1), timestamps en epoch millisecondes
--   - Postgres : TIMESTAMP WITH TIME ZONE, UUID
--
-- Ce fichier est EXÉCUTABLE : il recrée l'intégralité des deux schémas
-- (sections séparées, à exécuter dans la base correspondante).
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- PARTIE 1 — SYNC SERVER (SQLite)
-- À exécuter dans la base SQLite (ou via better-sqlite3 au démarrage).
-- ────────────────────────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Utilisateurs ──────────────────────────────────────────────────────────
-- Un compte = un email (UNIQUE). Le mot de passe est optionnel (OAuth).
-- Le token_version est incrémenté à la déconnexion pour invalider les
-- tokens JWT "stateless" existants.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                       -- UUID généré côté serveur
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT,                        -- NULL si compte OAuth uniquement
  verified INTEGER NOT NULL DEFAULT 0,       -- email vérifié (0/1)
  verification_code TEXT,                    -- code envoyé par email
  verification_code_expires_at INTEGER,      -- epoch ms
  token_version INTEGER NOT NULL DEFAULT 0,  -- invalidation de session
  created_at INTEGER NOT NULL                -- epoch ms
);

-- ── Espaces de travail (workspaces) ───────────────────────────────────────
-- Un workspace appartient à un propriétaire (owner_id) et contient des
-- collections + environnements. Relation 1─N : users → workspaces.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ── Appartenances (membres d'un workspace) ────────────────────────────────
-- Relation N─N : users ⇄ workspaces, avec un rôle par membre.
-- Le propriétaire du workspace est aussi enregistré ici (rôle 'owner').
CREATE TABLE IF NOT EXISTS memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

-- ── Invitations ───────────────────────────────────────────────────────────
-- Lien d'invitation à durée limitée vers un workspace.
-- Relation : invitations → workspaces (workspace_id), invitations → users (created_by).
CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY,                    -- token aléatoire du lien
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL,                        -- rôle accordé à l'acceptation
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);

-- ── Collections ───────────────────────────────────────────────────────────
-- Contenu JSON complet d'une collection (requêtes, assertions…).
-- Relation : collections → workspaces (workspace_id), → users (updated_by).
-- version : incrémenté à chaque mise à jour (optimistic concurrency).
-- deleted  : suppression logique (0/1).
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  data TEXT NOT NULL,                        -- JSON de la collection
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  deleted INTEGER NOT NULL DEFAULT 0
);

-- ── Environnements ────────────────────────────────────────────────────────
-- Variables d'environnement partagées (JSON), rattachées à un workspace.
-- Relation : environments → workspaces (workspace_id), → users (updated_by).
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  data TEXT NOT NULL,                        -- JSON des variables
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  deleted INTEGER NOT NULL DEFAULT 0
);

-- ── Dossiers (folders) ────────────────────────────────────────────────────
-- Regroupement de requêtes au sein d'une collection (JSON).
-- Relation : folders → collections (collection_id), → users (updated_by).
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  name TEXT NOT NULL,
  data TEXT NOT NULL,                        -- JSON des requêtes du dossier
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  deleted INTEGER NOT NULL DEFAULT 0
);

-- ── Hooklet : endpoints (boîte de réception webhook personnelle) ──────────
-- Un endpoint par utilisateur, exposé publiquement via un slug :
--   POST /api/hooklet/hooks/:slug
-- secret (optionnel) : si défini, le webhook doit présenter le header
--   x-webhook-secret (ou ?secret=) pour être accepté.
-- Relation : hooklet_endpoints → users (user_id).
CREATE TABLE IF NOT EXISTS hooklet_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,                 -- identifiant public de l'URL
  name TEXT NOT NULL,
  secret TEXT,                               -- secret partagé optionnel
  notify INTEGER NOT NULL DEFAULT 1,         -- notif push à la réception
  created_at INTEGER NOT NULL
);

-- ── Hooklet : événements reçus ────────────────────────────────────────────
-- Un webhook reçu = une ligne, stocké intégralement (rejouable).
-- headers : chaîne JSON.
-- replayed_from_id : référence l'événement d'origine lors d'un replay.
-- Relation : hooklet_events → users (user_id),
--            hooklet_events → hooklet_endpoints (endpoint_id),
--            hooklet_events → hooklet_events (replayed_from_id, auto-référence).
CREATE TABLE IF NOT EXISTS hooklet_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint_id INTEGER NOT NULL REFERENCES hooklet_endpoints(id),
  method TEXT NOT NULL,                      -- GET, POST…
  headers TEXT NOT NULL,                     -- JSON
  query TEXT,                                -- chaîne de requête brute
  body TEXT,
  content_type TEXT,
  source_ip TEXT,
  replayed_from_id INTEGER,                  -- événement source du replay
  created_at INTEGER NOT NULL
);

-- ── Hooklet : appareils mobiles (push Expo) ───────────────────────────────
-- Un token push Expo par appareil, pour les notifications de réception.
-- Relation : hooklet_devices → users (user_id).
CREATE TABLE IF NOT EXISTS hooklet_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT,                             -- ios / android
  device_name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- ── Index ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_collections_ws ON collections(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_environments_ws ON environments(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_folders_col ON folders(collection_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_hooklet_endpoints_user ON hooklet_endpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_hooklet_events_user ON hooklet_events(user_id);
CREATE INDEX IF NOT EXISTS idx_hooklet_events_endpoint ON hooklet_events(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_hooklet_devices_user ON hooklet_devices(user_id);

-- ── Migrations défensives (bases existantes) ──────────────────────────────
-- ⚠️ UNIQUEMENT pour les bases créées AVANT l'ajout de ces colonnes.
-- Sur une base neuve (DDL ci-dessus), ces ALTER échoueraient ("duplicate
-- column") — c'est normal : la colonne existe déjà. Le code (db.ts) les
-- exécute conditionnellement via PRAGMA table_info ; ici elles sont
-- documentées à titre de référence.
-- ALTER TABLE collections ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE collections ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE environments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE environments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE folders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE folders ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE users ADD COLUMN password_hash TEXT;
-- ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE users ADD COLUMN verification_code TEXT;
-- ALTER TABLE users ADD COLUMN verification_code_expires_at INTEGER;
-- ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- ── Migration : unicité stricte des emails ────────────────────────────────
-- Déduplique les comptes existants (garde le plus actif) puis crée l'index
-- unique. Ignorer les erreurs si la table est déjà propre.
DELETE FROM users WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY lower(email)
      ORDER BY
        (SELECT COUNT(*) FROM memberships m WHERE m.user_id = users.id) DESC,
        rowid ASC
    ) AS rn
    FROM users
  ) WHERE rn = 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);


-- ────────────────────────────────────────────────────────────────────────────
-- PARTIE 2 — SUPABASE (PostgreSQL)
-- À exécuter dans l'éditeur SQL Supabase (projet de NEXT_PUBLIC_SUPABASE_URL).
-- ────────────────────────────────────────────────────────────────────────────

-- ── Sessions de capture HTTP persistantes ─────────────────────────────────
-- Chaque requête HTTP interceptée par le proxy de capture est enregistrée ici
-- (web uniquement ; le desktop persiste dans captures.json côté app).
-- user_id : identifiant de l'utilisateur sync (texte), 'anonymous' par défaut.
CREATE TABLE IF NOT EXISTS capture_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Détails de la requête
  request_method TEXT NOT NULL,
  request_url TEXT NOT NULL,
  request_headers JSONB,
  request_body TEXT,

  -- Détails de la réponse
  response_status INT NOT NULL,
  response_headers JSONB,
  response_body TEXT,

  -- Métadonnées
  duration_ms INT NOT NULL DEFAULT 0,
  size_bytes INT NOT NULL DEFAULT 0,

  -- Colonne d'indexation dérivée (créée génériquement ; sert de helper)
  created_at_idx TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS (created_at) STORED
);

-- ── Index ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_capture_sessions_user_created ON capture_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capture_sessions_created_at ON capture_sessions(created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────
-- SÉCURITÉ : l'ancienne politique "Enable all operations for service role"
-- (FOR ALL USING(true)) donnait un accès complet à TOUS les rôles, y compris
-- anon (clé publique). Elle est supprimée ci-dessous.
--
-- Fonctionnement après migration :
--   - service_role (clé serveur) : contourne RLS via BYPASSRLS → accès total,
--     utilisé par l'application (reqy-web/lib/db.ts).
--   - anon / authenticated : aucune politique = refus par défaut, SAUF les
--     politiques ci-dessous pour les utilisateurs Supabase Auth.
ALTER TABLE capture_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all operations for service role" ON capture_sessions;

CREATE POLICY "Users read own sessions" ON capture_sessions
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users delete own sessions" ON capture_sessions
  FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);

-- ⚠️ ACTION REQUISE sur la base existante : la migration ci-dessus n'est
-- appliquée automatiquement que sur les nouvelles bases. Pour une base déjà
-- en production, exécuter au minimum :
--
--   DROP POLICY IF EXISTS "Enable all operations for service role" ON capture_sessions;


-- ═══════════════════════════════════════════════════════════════════════════
-- RÉSUMÉ DES RELATIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SQLite (sync server) :
--   users 1─N workspaces (owner_id)
--   users N─N workspaces (memberships, avec rôle)
--   users 1─N invitations (created_by)
--   workspaces 1─N invitations (workspace_id)
--   workspaces 1─N collections (workspace_id)
--   workspaces 1─N environments (workspace_id)
--   collections 1─N folders (collection_id)
--   users 1─N collections (updated_by) / environments (updated_by) / folders (updated_by)
--   users 1─N hooklet_endpoints (user_id)
--   users 1─N hooklet_events (user_id)
--   users 1─N hooklet_devices (user_id)
--   hooklet_endpoints 1─N hooklet_events (endpoint_id)
--   hooklet_events 1─1 hooklet_events (replayed_from_id, auto-référence)
--
-- PostgreSQL (Supabase) :
--   capture_sessions : table autonome (pas de FK — user_id est un texte
--   référençant l'utilisateur du sync server, pas une FK Supabase).
-- ═══════════════════════════════════════════════════════════════════════════
