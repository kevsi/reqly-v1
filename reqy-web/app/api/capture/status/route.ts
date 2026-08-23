/**
 * GET /api/capture/status
 * Get capture proxy status
 */

import { NextRequest, NextResponse } from "next/server";
import { getCaptureStatus } from "@/lib/capture-proxy";
import { requireCaptureUserId, CaptureAuthError } from "@/lib/capture-auth";

export async function GET(request: NextRequest) {
  try {
    await requireCaptureUserId(request);
    const status = await getCaptureStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[Capture Status] Error:", error);
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get status" },
      { status: 400 },
    );
  }
}
