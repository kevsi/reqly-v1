import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Lightweight readiness endpoint for Fly and external monitors. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
