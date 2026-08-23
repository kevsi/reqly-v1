/**
 * POST /api/capture/stop
 * Stop HTTP capture proxy
 */

import { NextRequest, NextResponse } from "next/server";
import { stopCapture } from "@/lib/capture-proxy";
import { requireCaptureUserId, CaptureAuthError } from "@/lib/capture-auth";

export async function POST(request: NextRequest) {
  try {
    await requireCaptureUserId(request);
    const result = await stopCapture();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Capture Stop] Error:", error);
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop capture" },
      { status: 400 },
    );
  }
}
