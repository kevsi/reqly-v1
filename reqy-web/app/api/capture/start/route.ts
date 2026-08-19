/**
 * POST /api/capture/start
 * Start HTTP capture proxy
 */

import { NextRequest, NextResponse } from "next/server";
import { startCapture } from "@/lib/capture-proxy";

export async function POST(request: NextRequest) {
  try {
    let bandwidthLimitMbps: number | undefined;
    try {
      const body = await request.json();
      if (body?.bandwidthLimitMbps) bandwidthLimitMbps = Number(body.bandwidthLimitMbps);
    } catch {
      // Body is optional
    }

    const result = await startCapture({
      bandwidthLimitMbps,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Capture Start] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
