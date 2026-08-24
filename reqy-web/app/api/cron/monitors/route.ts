/**
 * GET /api/cron/monitors
 *
 * Exécution cloud des monitors dus (déclenchée par un cron externe type
 * cron-job.org — Vercel Hobby limite ses crons natifs à 1×/jour).
 *
 * Auth : Bearer MONITOR_CRON_SECRET.
 * Design batch : traite au plus 10 monitors dus par invocation (<30 s pour
 * respecter le timeout du déclencheur), le tick suivant draine la file.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { evaluateMonitorResults, buildAlertPayload } from "@/lib/monitors/shared";
import {
  executeMonitorRequestServer,
  MonitorRequestError,
} from "@/lib/monitors/server-executor";
import { sendMonitorWebhook } from "@/lib/monitors/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_LIMIT = 10;
const PER_REQUEST_TIMEOUT_MS = 10_000;

interface MonitorConfigRow {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  interval_sec: number;
  checks: {
    expectedStatus?: number;
    latencyThresholdMs?: number;
    headers?: Array<{ name: string; contains?: string }>;
    bodyContains?: string;
    bodyJsonPath?: string;
  };
  webhook_url: string | null;
  requests: Array<{
    id: string;
    name: string;
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }>;
}

export async function GET(request: NextRequest) {
  // ── Auth du déclencheur ────────────────────────────────────────────────
  const secret = process.env.MONITOR_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "MONITOR_CRON_SECRET non configuré côté serveur." },
      { status: 503 },
    );
  }
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token !== secret) return unauthorized();

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const nowIso = new Date().toISOString();

  // ── Sélection puis claim atomique des monitors dus ────────────────────
  const { data: due, error: dueError } = await supabase
    .from("monitor_configs")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (dueError) {
    return NextResponse.json({ error: dueError.message }, { status: 500 });
  }

  const executed: Array<{ id: string; name: string; status?: string; error?: string }> = [];

  for (const row of (due ?? []) as unknown as MonitorConfigRow[]) {
    // Claim d'abord : si l'exécution crashe, on rate un cycle au lieu de
    // boucler à l'infini sur le même monitor.
    const nextDue = new Date(Date.now() + Math.max(60, row.interval_sec) * 1000).toISOString();
    const claimed = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("monitor_configs") as any
    )
      .update({ next_run_at: nextDue })
      .eq("id", row.id)
      .eq("enabled", true)
      .select("id")
      .limit(1);
    if (claimed.error || (claimed.data?.length ?? 0) === 0) continue;

    try {
      executed.push(await executeOne(supabase, row));
    } catch (err) {
      executed.push({
        id: row.id,
        name: row.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    executedCount: executed.length,
    executed,
    serverTime: new Date().toISOString(),
  });

  function unauthorized() {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

// ── Exécution d'un monitor ───────────────────────────────────────────────

async function executeOne(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  row: MonitorConfigRow,
): Promise<{ id: string; name: string; status?: string; error?: string }> {
  const checks = {
    expectedStatus: row.checks?.expectedStatus ?? 200,
    latencyThresholdMs: row.checks?.latencyThresholdMs,
    headers: row.checks?.headers,
    bodyContains: row.checks?.bodyContains,
    bodyJsonPath: row.checks?.bodyJsonPath,
  };

  // Exécution directe (pas de runner navigateur) : scripts désactivés par
  // conception, chaque requête via l'executor serveur SSRF-guardé.
  type ResultRow = {
    requestId: string;
    name: string;
    error?: string;
    statusCode?: number;
    responseTimeMs?: number;
    responseBodyPreview?: string;
    responseHeaders?: Record<string, string>;
  };
  const results: ResultRow[] = [];
  for (const request of row.requests ?? []) {
    const base = {
      requestId: request.id,
      name: request.name,
    };
    try {
      const res = await executeMonitorRequestServer({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        timeoutMs: PER_REQUEST_TIMEOUT_MS,
      });
      results.push({
        ...base,
        statusCode: res.statusCode,
        responseTimeMs: res.responseTimeMs,
        responseBodyPreview: res.bodyText,
        responseHeaders: res.headersLower,
      });
    } catch (err) {
      results.push({
        ...base,
        error:
          err instanceof MonitorRequestError && err.kind === "ssrf"
            ? `SSRF_BLOCKED : ${err.message}`
            : err instanceof Error
              ? err.message
              : "Erreur inconnue",
      });
    }
  }

  const evaluated = evaluateMonitorResults(results, checks);

  // Historique serveur
  const record = {
    monitor_id: row.id,
    at: new Date().toISOString(),
    status: evaluated.status,
    duration_ms: Math.max(
      0,
      ...results.map((r) => r.responseTimeMs ?? 0),
    ),
    checks: evaluated.checksOut,
  };
  const insert = await (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("monitor_runs") as any
  ).insert(record);
  if (insert.error) {
    return { id: row.id, name: row.name, error: insert.error.message };
  }

  // ── Webhook sur transition ────────────────────────────────────────────
  if (row.webhook_url) {
    // Après insertion du run courant, index 1 (desc) = run précédent.
    const lastRun = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("monitor_runs") as any
    )
      .select("status")
      .eq("monitor_id", row.id)
      .order("at", { ascending: false })
      .range(1, 1);
    const previous = (lastRun.data as Array<{ status: "pass" | "fail" | "degraded" }> | null)?.[0]
      ?.status;
    const alert = buildAlertPayload(
      row,
      { at: Date.parse(record.at), durationMs: record.duration_ms, status: evaluated.status },
      evaluated.checksOut,
      previous,
    );
    if (alert) {
      void sendMonitorWebhook(row.webhook_url, alert.payload);
    }
  }

  return { id: row.id, name: row.name, status: evaluated.status };
}
