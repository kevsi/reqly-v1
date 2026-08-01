import { NextResponse } from "next/server";

export function structuredError(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}
