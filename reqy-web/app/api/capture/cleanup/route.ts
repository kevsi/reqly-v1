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

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 second timeout for cleanup

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Optional: Add authorization check here
    // const authHeader = req.headers.get('authorization')
    // if (!authHeader?.startsWith('Bearer ')) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // }

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
