export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getApiKeyFromRequest } from "../cookies";

export async function GET(request: NextRequest) {
  const apiKey = getApiKeyFromRequest(request);
  return NextResponse.json({
    connected: !!apiKey,
  });
}
