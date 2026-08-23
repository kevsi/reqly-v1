/**
 * POST /api/capture/start
 * Start HTTP capture proxy
 */

import { NextRequest, NextResponse } from "next/server";
import { startCapture } from "@/lib/capture-proxy";
import { requireCaptureUserId, CaptureAuthError } from "@/lib/capture-auth";

export async function POST(request: NextRequest) {
  try {
    // Capture start/stop est un interrupteur global : il doit être réservé aux
    // utilisateurs authentifiés (un visiteur anonyme ne doit pas pouvoir
    // activer/désactiver l'enregistrement pour tout le monde).
    await requireCaptureUserId(request);

    let bandwidthLimitMbps: number | undefined;
    try {
      const body = await request.json();
      const raw = Number(body?.bandwidthLimitMbps);
      if (Number.isFinite(raw) && raw > 0) {
        bandwidthLimitMbps = Math.min(Math.max(Math.round(raw), 1), 10000);
      }
    } catch {
      // Body is optional
    }

    const result = await startCapture({
      bandwidthLimitMbps,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Capture Start] Error:", error);
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
