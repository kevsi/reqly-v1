/**
 * GET /api/capture/sessions/[id]
 * Get a specific captured session
 */

import { NextRequest, NextResponse } from "next/server";
import { getCaptureSession } from "@/lib/capture-proxy";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const session = await getCaptureSession(id);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("[Capture Get] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get session" },
      { status: 400 },
    );
  }
}
