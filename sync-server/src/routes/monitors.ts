/**
 * Routes Monitors serveur : CRUD des définitions poussées par le client
 * desktop + lecture de l'historique des runs exécutés par le scheduler.
 *
 * Les monitors sont rattachés à l'utilisateur (pas à un workspace) : la
 * définition est un snapshot autonome qui survit à la suppression des
 * collections, comme côté client.
 */
import { Hono } from "hono";
import db from "../db.js";
import { requireAuth, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";
import { MonitorDefinitionSchema, newMonitorId } from "../monitors-runner.js";

const monitors = new Hono<{ Variables: { auth: AuthContext } }>();
monitors.use("*", requireAuth);

interface MonitorRow {
  id: string;
  name: string;
  enabled: number;
  interval_sec: number;
  definition: string;
  next_run_at: number;
  last_status: string | null;
  created_at: number;
  updated_at: number;
}

function rowToSummary(row: MonitorRow) {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    intervalSec: row.interval_sec,
    lastStatus: row.last_status,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Vérifie que le monitor appartient bien à l'utilisateur courant. */
function ownedMonitor(id: string, userId: string): MonitorRow | undefined {
  return db
    .prepare(`SELECT * FROM monitors WHERE id = ? AND user_id = ?`)
    .get(id, userId) as MonitorRow | undefined;
}

monitors.get("/", (c) => {
  const auth = c.get("auth") as AuthContext;
  const rows = db
    .prepare(`SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at ASC`)
    .all(auth.userId) as MonitorRow[];
  return c.json({ monitors: rows.map(rowToSummary) });
});

monitors.post("/", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, MonitorDefinitionSchema);
  if (!parsed.success) return parsed.response;
  const definition = parsed.data;

  const id = newMonitorId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO monitors (id, user_id, name, enabled, interval_sec, definition, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    auth.userId,
    definition.name,
    definition.enabled ? 1 : 0,
    definition.intervalSec,
    JSON.stringify(definition),
    now + definition.intervalSec * 1000,
    now,
    now,
  );
  return c.json({ monitor: { id, nextRunAt: now + definition.intervalSec * 1000 } }, 201);
});

monitors.patch("/:id", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  const existing = ownedMonitor(id, auth.userId);
  if (!existing) return c.json({ error: "Monitor not found" }, 404);

  const parsed = await safeParseJson(c, MonitorDefinitionSchema.partial());
  if (!parsed.success) return parsed.response;
  const patch = parsed.data;

  const merged = {
    name: patch.name ?? existing.name,
    enabled: patch.enabled ?? existing.enabled === 1,
    intervalSec: patch.intervalSec ?? existing.interval_sec,
    definition: existing.definition,
  };
  // Si la définition complète est fournie, on la remplace et on revalide.
  let definitionJson = existing.definition;
  if (patch.requests || patch.checks || patch.webhookUrl !== undefined) {
    const current = MonitorDefinitionSchema.parse(JSON.parse(existing.definition));
    const next = MonitorDefinitionSchema.parse({
      ...current,
      ...patch,
    });
    definitionJson = JSON.stringify(next);
    merged.name = next.name;
    merged.enabled = next.enabled;
    merged.intervalSec = next.intervalSec;
  }

  const now = Date.now();
  // Un changement d'intervalle ou de définition reprogramme la prochaine
  // exécution ; un simple toggle enabled/non n'accélère rien.
  const rescheduled =
    patch.requests || patch.checks || patch.webhookUrl !== undefined || patch.intervalSec !== undefined;
  const nextRunAt = rescheduled
    ? now + merged.intervalSec * 1000
    : existing.next_run_at;

  db.prepare(
    `UPDATE monitors SET name = ?, enabled = ?, interval_sec = ?, definition = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
  ).run(merged.name, merged.enabled ? 1 : 0, merged.intervalSec, definitionJson, nextRunAt, now, id);

  const updated = ownedMonitor(id, auth.userId)!;
  return c.json({ monitor: rowToSummary(updated) });
});

monitors.delete("/:id", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  const result = db.prepare(`DELETE FROM monitors WHERE id = ? AND user_id = ?`).run(id, auth.userId);
  if (result.changes === 0) return c.json({ error: "Monitor not found" }, 404);
  return c.json({ ok: true });
});

monitors.get("/:id/runs", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  if (!ownedMonitor(id, auth.userId)) return c.json({ error: "Monitor not found" }, 404);

  const rows = db
    .prepare(
      `SELECT id, status, duration_ms as durationMs, checks, created_at as at
       FROM monitor_runs WHERE monitor_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
    .all(id) as Array<{ id: number; status: string; durationMs: number; checks: string; at: number }>;

  return c.json({
    runs: rows.map((row) => ({ ...row, checks: JSON.parse(row.checks) })),
  });
});

export default monitors;
