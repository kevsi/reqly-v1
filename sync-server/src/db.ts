import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH =
  process.env.REQLY_DB_PATH === ":memory:"
    ? ":memory:"
    : path.resolve(
        process.env.REQLY_DB_PATH ??
          path.join(path.resolve(process.cwd(), "data"), "reqly-sync.db"),
      );

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    verification_code TEXT,
    verification_code_expires_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memberships (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS invitations (
    token TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL REFERENCES users(id),
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL REFERENCES users(id),
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id),
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL REFERENCES users(id),
    deleted INTEGER NOT NULL DEFAULT 0
  );

  -- ── Hooklet (personal webhook inbox) tables ─────────────────────────────
  -- A personal webhook endpoint. Each user can create multiple endpoints; each
  -- has a public slug used to build the ingest URL: /api/hooklet/hooks/:slug.
  CREATE TABLE IF NOT EXISTS hooklet_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- Optional shared secret. When set, incoming requests must present it via
    -- the x-webhook-secret header (or ?secret= query param) to be accepted.
    secret TEXT,
    -- Whether new events on this endpoint trigger a push notification.
    notify INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  -- A single received webhook request, stored in full so it can be inspected
  -- and replayed later. headers is stored as a JSON string.
  CREATE TABLE IF NOT EXISTS hooklet_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    endpoint_id INTEGER NOT NULL REFERENCES hooklet_endpoints(id),
    method TEXT NOT NULL,
    headers TEXT NOT NULL,
    query TEXT,
    body TEXT,
    content_type TEXT,
    source_ip TEXT,
    -- Set when this event was created by replaying another event.
    replayed_from_id INTEGER,
    created_at INTEGER NOT NULL
  );

  -- An Expo push token registered by the hooklet mobile app for a user.
  CREATE TABLE IF NOT EXISTS hooklet_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    expo_push_token TEXT NOT NULL UNIQUE,
    platform TEXT,
    device_name TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_collections_ws ON collections(workspace_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_environments_ws ON environments(workspace_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_folders_col ON folders(collection_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_hooklet_endpoints_user ON hooklet_endpoints(user_id);
  CREATE INDEX IF NOT EXISTS idx_hooklet_events_user ON hooklet_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_hooklet_events_endpoint ON hooklet_events(endpoint_id);
  CREATE INDEX IF NOT EXISTS idx_hooklet_devices_user ON hooklet_devices(user_id);
`);

// Defensive migration: an existing DB file created before the `version`/`deleted`
// columns were added would otherwise fail at query time ("no such column").
function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

for (const table of ["collections", "environments", "folders"]) {
  ensureColumn(table, "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(table, "deleted", "INTEGER NOT NULL DEFAULT 0");
}

// Password hash is optional: OAuth-based sessions don't set it.
ensureColumn("users", "password_hash", "TEXT");

// Email verification support
ensureColumn("users", "verified", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "verification_code", "TEXT");
ensureColumn("users", "verification_code_expires_at", "INTEGER");

// Session revocation: bumped on logout so existing (stateless) tokens die.
ensureColumn("users", "token_version", "INTEGER NOT NULL DEFAULT 0");

// Migration: enforce a single account per email. Older DBs may already hold
// duplicates from a signup race (SELECT-then-INSERT). Dedupe first — keep the
// account that is in use (has memberships), tiebreak by insertion order — then
// create the unique index. Fresh DBs already have email UNIQUE from the DDL.
db.exec(`
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
`);

export default db;
