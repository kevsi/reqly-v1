/**
 * Sync cloud des monitors pour l'app (auth utilisateur via session Reqly).
 *
 * GET  /api/monitors          → configs de l'utilisateur + derniers runs
 * PUT  /api/monitors          → upsert des configs locales (clé user_id+name)
 *
 * Stockage : Supabase service-role, filtré par user_id côté requêtes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { requireCaptureUserId, CaptureAuthError } from "@/lib/capture-auth";

export const dynamic = "force-dynamic";

function unauthorized(status: 401 | 503, message: string) {
  return NextResponse.json({ error: message }, { status });
}

async function auth(request: NextRequest): Promise<string | null> {
  try {
    return await requireCaptureUserId(request);
  } catch (err) {
    if (err instanceof CaptureAuthError) return null;
    return null;
  }
}

export async function GET(request: NextRequest) {
  const userId = await auth(request);
  if (!userId) return unauthorized(401, "Authentication required");

  const supabase = getSupabaseClient();
  if (!supabase) return unauthorized(503, "Supabase non configuré");

  const { data: configs, error: configError } = await (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("monitor_configs") as any
  )
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  const ids = (configs ?? []).map((c: { id: string }) => c.id);
  const { data: runs } =
    ids.length > 0
      ? await (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase.from("monitor_runs") as any
        )
          .select("*")
          .in("monitor_id", ids)
          .order("at", { ascending: false })
          .limit(500)
      : { data: [] };

  return NextResponse.json({ monitors: configs ?? [], runs: runs ?? [] });
}

interface IncomingMonitor {
  name?: unknown;
  enabled?: unknown;
  interval_sec?: unknown;
  checks?: unknown;
  webhook_url?: unknown;
  requests?: unknown;
}

/** Valide et normalise une config entrante (défense en profondeur). */
function sanitizeIncoming(raw: IncomingMonitor) {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "";
  const enabled = raw.enabled !== false;
  const allowed = [300, 900, 1800, 3600, 86400];
  const intervalRaw = Number(raw.interval_sec);
  const interval_sec = allowed.includes(intervalRaw) ? intervalRaw : 1800;
  const checksRaw = (raw.checks ?? {}) as Record<string, unknown>;
  const expectedStatus =
    typeof checksRaw.expectedStatus === "number" && Number.isFinite(checksRaw.expectedStatus)
      ? Math.round(checksRaw.expectedStatus)
      : 200;
  const latencyThresholdMs =
    typeof checksRaw.latencyThresholdMs === "number" && checksRaw.latencyThresholdMs > 0
      ? Math.round(checksRaw.latencyThresholdMs)
      : undefined;
  const headers = Array.isArray(checksRaw.headers)
    ? checksRaw.headers
        .filter(
          (h): h is { name: string; contains?: string } =>
            !!h &&
            typeof h === "object" &&
            typeof (h as { name?: unknown }).name === "string" &&
            ((h as { name: string }).name).length > 0,
        )
        .slice(0, 10)
        .map((h) => ({
          name: h.name.slice(0, 120),
          ...(typeof h.contains === "string" && h.contains.length > 0
            ? { contains: h.contains.slice(0, 300) }
            : {}),
        }))
    : undefined;
  const bodyContains =
    typeof checksRaw.bodyContains === "string" && checksRaw.bodyContains.length > 0
      ? checksRaw.bodyContains.slice(0, 500)
      : undefined;
  const bodyJsonPath =
    typeof checksRaw.bodyJsonPath === "string" && checksRaw.bodyJsonPath.length > 0
      ? checksRaw.bodyJsonPath.slice(0, 300)
      : undefined;
  const requests = Array.isArray(raw.requests)
    ? raw.requests
        .filter(
          (r): r is Record<string, unknown> =>
            !!r && typeof r === "object",
        )
        .map((r) => ({
          id: String(r.id ?? "").slice(0, 120),
          name: String(r.name ?? "").slice(0, 200),
          method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
            String(r.method ?? "").toUpperCase(),
          )
            ? String(r.method).toUpperCase()
            : "GET",
          url: String(r.url ?? "").slice(0, 2048),
          headers:
            r.headers && typeof r.headers === "object"
              ? (Object.fromEntries(
                  Object.entries(r.headers as Record<string, unknown>)
                    .filter(([, v]) => v != null)
                    .slice(0, 30)
                    .map(([k, v]) => [String(k).slice(0, 200), String(v).slice(0, 2000)]),
                ) as Record<string, string>)
              : undefined,
          body: typeof r.body === "string" ? r.body.slice(0, 64 * 1024) : undefined,
        }))
        .filter((r) => r.id.length > 0 && /^https?:\/\//i.test(r.url))
        .slice(0, 100)
    : [];

  const webhook_url =
    typeof raw.webhook_url === "string" &&
    /^https:\/\//i.test(raw.webhook_url.trim()) // https only server-side
      ? raw.webhook_url.trim().slice(0, 500)
      : undefined;

  if (!name || requests.length === 0) return null;

  return {
    name,
    enabled,
    interval_sec,
    checks: {
      expectedStatus,
      ...(latencyThresholdMs ? { latencyThresholdMs } : {}),
      ...(headers && headers.length > 0 ? { headers } : {}),
      ...(bodyContains ? { bodyContains } : {}),
      ...(bodyJsonPath ? { bodyJsonPath } : {}),
    },
    ...(webhook_url ? { webhook_url } : {}),
    requests,
  };
}

export async function PUT(request: NextRequest) {
  const userId = await auth(request);
  if (!userId) return unauthorized(401, "Authentication required");

  const supabase = getSupabaseClient();
  if (!supabase) return unauthorized(503, "Supabase non configuré");

  let body: { monitors?: unknown };
  try {
    body = (await request.json()) as { monitors?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  if (!Array.isArray(body.monitors)) {
    return NextResponse.json({ error: "monitors[] requis" }, { status: 400 });
  }

  const sanitized = body.monitors
    .map((m) => sanitizeIncoming(m as IncomingMonitor))
    .filter((m): m is NonNullable<ReturnType<typeof sanitizeIncoming>> => m !== null)
    .slice(0, 50);

  if (sanitized.length === 0) {
    return NextResponse.json({ error: "Aucune monitor valide." }, { status: 400 });
  }

  // Upsert par (user_id, name) : les éditions locales écrasent le cloud.
  let upserted = 0;
  for (const monitor of sanitized) {
    const findExisting = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("monitor_configs") as any
    )
      .select("id")
      .eq("user_id", userId)
      .eq("name", monitor.name)
      .limit(1);

    if (findExisting.data && findExisting.data.length > 0) {
      const id = (findExisting.data[0] as { id: string }).id;
      const update = await (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("monitor_configs") as any
      )
        .update({ ...monitor, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (!update.error) upserted += 1;
    } else {
      const insert = await (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("monitor_configs") as any
      ).insert({
        user_id: userId,
        ...monitor,
      });
      if (!insert.error) upserted += 1;
    }
  }

  return NextResponse.json({ upserted, received: sanitized.length });
}
