/**
 * GET /api/capture/status
 * Get capture proxy status
 */

import { NextRequest, NextResponse } from "next/server";
import { getCaptureStatus } from "@/lib/capture-proxy";

export async function GET(request: NextRequest) {
  try {
    const status = await getCaptureStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[Capture Status] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get status" },
      { status: 400 },
    );
  }
}
