/**
 * GET /api/capture/sessions/[id]
 * Get a specific captured session
 */

import { NextRequest, NextResponse } from "next/server";
import { getCaptureSession, deleteCaptureSession } from "@/lib/capture-proxy";
import { CaptureAuthError, requireCaptureUserId } from "@/lib/capture-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const userId = await requireCaptureUserId(request);
    const session = await getCaptureSession(id, userId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Capture Get] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get session" },
      { status: 400 },
    );
  }
}

/**
 * DELETE /api/capture/sessions/[id]
 * Supprime une session capturée (propriétaire uniquement).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const userId = await requireCaptureUserId(request);
    const ok = await deleteCaptureSession(id, userId);

    if (!ok) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Capture Delete] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete session" },
      { status: 400 },
    );
  }
}
