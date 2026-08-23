/**
 * GET /api/capture/sessions
 * List all captured sessions
 *
 * Query params:
 * - sort: 'newest' | 'oldest' (default: newest)
 * - limit: number (default: 100)
 */

import { NextRequest, NextResponse } from "next/server";
import { listCaptureSessions, clearCaptureSessions } from "@/lib/capture-proxy";
import { CaptureAuthError, requireCaptureUserId } from "@/lib/capture-auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireCaptureUserId(request);
    const sessions = await listCaptureSessions(userId);

    const sort = request.nextUrl.searchParams.get("sort") || "newest";
    const rawLimit = parseInt(request.nextUrl.searchParams.get("limit") || "100");
    // Clamp : éviter les valeurs négatives ou déraisonnables.
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;

    const sorted = [...sessions];
    if (sort === "oldest") {
      sorted.reverse();
    }

    const paginated = sorted.slice(0, limit);

    return NextResponse.json({
      total: sessions.length,
      limit,
      sessions: paginated,
    });
  } catch (error) {
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Capture List] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list sessions" },
      { status: 400 },
    );
  }
}

/**
 * DELETE /api/capture/sessions
 * Clear all captured sessions
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireCaptureUserId(request);
    const result = await clearCaptureSessions(userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CaptureAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Capture Clear] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear sessions" },
      { status: 400 },
    );
  }
}
