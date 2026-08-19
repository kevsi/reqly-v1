/**
 * POST /api/capture/stop
 * Stop HTTP capture proxy
 */

import { NextRequest, NextResponse } from "next/server";
import { stopCapture } from "@/lib/capture-proxy";

export async function POST(request: NextRequest) {
  try {
    const result = await stopCapture();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Capture Stop] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop capture" },
      { status: 400 },
    );
  }
}
