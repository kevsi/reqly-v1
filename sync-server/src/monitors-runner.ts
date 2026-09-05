/**
 * Exécution serveur des Monitors.
 *
 * Le client desktop pousse une définition de monitor (snapshot autonome des
 * requêtes + checks). Le serveur planifie les exécutions (setInterval local,
 * déploiement mono-instance), évalue les checks et stocke l'historique des
 * runs. Les webhooks ne partent que sur transition d'état (fail/degraded/
 * rétabli) pour éviter le bruit.
 *
 * Sécurité : les URLs de requête ET les webhooks sont contrôlés par le
 * garde SSRF local — protocole http/https uniquement, DNS résolu, refus
 * de localhost/loopback/plages privées et réservées. Le serveur ne doit
 * jamais devenir un proxy d'intranet.
 */
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import db from "./db.js";

// ── Garde SSRF ──────────────────────────────────────────────────────────────

class UnsafeUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("2001:db8:")) return true;
  const v4 = lower.split(":").pop();
  if (v4 && v4.includes(".")) return isPrivateIpv4(v4);
  return false;
}

/** Valide protocole + hôte, résout le DNS et refuse les IP non publiques. */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL invalide");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError(`Protocole interdit : ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("Hôte absent");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError(`Hôte non autorisé : ${host}`);
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  for (const { address } of addresses) {
    if (address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address)) {
      throw new UnsafeUrlError(`Adresse IP non autorisée : ${address}`);
    }
  }
  return url;
}

// ── Schéma de définition ────────────────────────────────────────────────────

export const MONITOR_INTERVALS = [60, 300, 900, 3600] as const;

const MonitorHttpRequestSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().min(1).max(2048),
  headers: z.record(z.string().max(1024)).optional(),
  body: z.string().max(64 * 1024).optional(),
});

const MonitorChecksSchema = z.object({
  expectedStatus: z.number().int().min(100).max(599).default(200),
  latencyThresholdMs: z.number().int().min(1).max(60_000).optional(),
  headers: z
    .array(z.object({ name: z.string().min(1).max(200), contains: z.string().max(500).optional() }))
    .max(10)
    .optional(),
  bodyContains: z.string().max(500).optional(),
  bodyJsonPath: z.string().max(200).optional(),
});

export const MonitorDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  intervalSec: z.union([
    z.literal(MONITOR_INTERVALS[0]),
    z.literal(MONITOR_INTERVALS[1]),
    z.literal(MONITOR_INTERVALS[2]),
    z.literal(MONITOR_INTERVALS[3]),
  ]),
  checks: MonitorChecksSchema,
  webhookUrl: z.string().max(2048).optional(),
  requests: z.array(MonitorHttpRequestSchema).min(1).max(20),
});

export type MonitorDefinition = z.infer<typeof MonitorDefinitionSchema>;

// ── Exécution d'une requête de monitor ──────────────────────────────────────

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface MonitorRunCheck {
  requestId: string;
  name: string;
  ok: boolean;
  statusCode?: number;
  durationMs?: number;
  degraded?: boolean;
  error?: string;
}

interface RequestOutcome {
  check: MonitorRunCheck;
  bodyText: string;
  headers: Record<string, string>;
}

async function executeRequest(
  request: MonitorDefinition["requests"][number],
  expectedStatus: number,
  latencyThresholdMs?: number,
): Promise<RequestOutcome> {
  const started = Date.now();
  try {
    const url = await assertPublicHttpUrl(request.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        signal: controller.signal,
        redirect: "manual",
      });
      const durationMs = Date.now() - started;
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const buffer = await res.arrayBuffer();
      const bodyText = new TextDecoder("utf-8", { fatal: false }).decode(
        buffer.slice(0, MAX_RESPONSE_BYTES),
      );
      return {
        check: {
          requestId: request.id,
          name: request.name,
          ok: res.status === expectedStatus,
          statusCode: res.status,
          durationMs,
          degraded: latencyThresholdMs !== undefined && durationMs > latencyThresholdMs,
        },
        bodyText,
        headers,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message =
      error instanceof UnsafeUrlError
        ? error.message
        : error instanceof Error && error.name === "AbortError"
          ? "Délai dépassé"
          : "Requête impossible";
    return {
      check: { requestId: request.id, name: request.name, ok: false, error: message },
      bodyText: "",
      headers: {},
    };
  }
}

/** Résout un chemin JSON simple : `a.b[0].c` → valeur (null si absent). */
function resolveJsonPath(doc: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: unknown = doc;
  for (const segment of segments) {
    if (current === null || current === undefined) return null;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  return current;
}

function evaluateChecks(
  definition: MonitorDefinition,
  outcomes: RequestOutcome[],
): { status: "pass" | "fail" | "degraded"; checks: MonitorRunCheck[] } {
  const { checks } = definition;
  let failed = false;
  let degraded = false;

  for (const outcome of outcomes) {
    const c = outcome.check;
    if (!c.ok) failed = true;
    if (c.degraded) degraded = true;

    for (const headerCheck of checks.headers ?? []) {
      const value = outcome.headers[headerCheck.name.toLowerCase()];
      if (value === undefined || (headerCheck.contains !== undefined && !value.includes(headerCheck.contains))) {
        failed = true;
      }
    }
    if (checks.bodyContains && !outcome.bodyText.includes(checks.bodyContains)) {
      failed = true;
    }
    if (checks.bodyJsonPath) {
      try {
        const value = resolveJsonPath(JSON.parse(outcome.bodyText), checks.bodyJsonPath);
        if (value === null || value === undefined) failed = true;
      } catch {
        failed = true;
      }
    }
  }

  const status = failed ? "fail" : degraded ? "degraded" : "pass";
  return { status, checks: outcomes.map((o) => o.check) };
}

// ── Webhook (transition uniquement) ─────────────────────────────────────────

async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const target = await assertPublicHttpUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Un webhook qui échoue ne doit jamais casser le run.
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

const SCHEDULER_TICK_MS = 30_000;
const MAX_RUNS_KEPT = 100;
const MAX_MONITORS_PER_TICK = 10;

interface MonitorRow {
  id: string;
  user_id: string;
  definition: string;
  interval_sec: number;
  last_status: string | null;
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runDueMonitors(now = Date.now()): Promise<number> {
  if (running) return 0;
  running = true;
  let executed = 0;
  try {
    const rows = db
      .prepare(
        `SELECT id, user_id, definition, interval_sec, last_status
         FROM monitors WHERE enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC LIMIT ?`,
      )
      .all(now, MAX_MONITORS_PER_TICK) as MonitorRow[];

    for (const row of rows) {
      // Réserve l'exécution immédiatement (anti-réentrance même si le run
      // plante) puis exécute en séquence — déploiement mono-instance.
      const nextRunAt = Date.now() + row.interval_sec * 1000;
      db.prepare(`UPDATE monitors SET next_run_at = ? WHERE id = ?`).run(nextRunAt, row.id);

      let definition: MonitorDefinition;
      try {
        definition = MonitorDefinitionSchema.parse(JSON.parse(row.definition));
      } catch {
        continue;
      }

      const outcomes: RequestOutcome[] = [];
      for (const request of definition.requests) {
        outcomes.push(await executeRequest(request, definition.checks.expectedStatus, definition.checks.latencyThresholdMs));
      }
      const { status, checks } = evaluateChecks(definition, outcomes);
      const durationMs = outcomes.reduce((sum, o) => sum + (o.check.durationMs ?? 0), 0);

      db.prepare(
        `INSERT INTO monitor_runs (monitor_id, status, duration_ms, checks, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(row.id, status, durationMs, JSON.stringify(checks), Date.now());
      db.prepare(
        `DELETE FROM monitor_runs WHERE monitor_id = ? AND id NOT IN (
           SELECT id FROM monitor_runs WHERE monitor_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
         )`,
      ).run(row.id, row.id, MAX_RUNS_KEPT);

      // Webhook sur transition uniquement.
      const previous = row.last_status;
      if (definition.webhookUrl && (status === "pass" ? previous !== undefined && previous !== "pass" : previous !== status)) {
        void sendWebhook(definition.webhookUrl, {
          monitorId: row.id,
          name: definition.name,
          status,
          previousStatus: previous,
          at: Date.now(),
        });
      }
      db.prepare(`UPDATE monitors SET last_status = ? WHERE id = ?`).run(status, row.id);
      executed += 1;
    }
  } finally {
    running = false;
  }
  return executed;
}

export function startMonitorScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void runDueMonitors();
  }, SCHEDULER_TICK_MS);
  schedulerTimer.unref?.();
}

/** Pour les tests : arrête le scheduler. */
export function stopMonitorScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

/** Insère un run directement (routes de test / exécution manuelle). */
export function recordRun(monitorId: string, status: string, durationMs: number, checks: MonitorRunCheck[]): void {
  db.prepare(
    `INSERT INTO monitor_runs (monitor_id, status, duration_ms, checks, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(monitorId, status, durationMs, JSON.stringify(checks), Date.now());
}

export { UnsafeUrlError };
export function newMonitorId(): string {
  return `mon-${randomUUID()}`;
}
