/**
 * Capture Session Cleanup Endpoint
 * DELETE sessions older than 30 days automatically
 *
 * Usage:
 * - Scheduled: Configure in vercel.json or GitHub Actions
 * - Manual: POST /api/capture/cleanup (requires internal auth)
 *
 * @route GET /api/capture/cleanup
 * @returns { clearedCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { cleanupOldSessions } from "@/lib/db";
import { createHash, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 second timeout for cleanup

/** Comparaison à temps constant (anti-timing-attack sur le secret). */
function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const expected = process.env.CAPTURE_CLEANUP_SECRET;
    const provided = req.headers.get("x-capture-cleanup-secret");
    if (!expected || !provided || !secretsEqual(expected, provided)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const daysOld = 30; // Configurable via query param if needed
    const clearedCount = await cleanupOldSessions(daysOld);

    return NextResponse.json(
      {
        success: true,
        message: `Cleaned up ${clearedCount} sessions older than ${daysOld} days`,
        clearedCount,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Cleanup] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Cleanup failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
