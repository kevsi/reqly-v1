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

export async function GET(request: NextRequest) {
  try {
    const sessions = await listCaptureSessions();

    const sort = request.nextUrl.searchParams.get("sort") || "newest";
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100");

    let sorted = [...sessions];
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
    const result = await clearCaptureSessions();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Capture Clear] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear sessions" },
      { status: 400 },
    );
  }
}
