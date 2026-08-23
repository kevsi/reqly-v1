export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getApiKeyFromRequest, getUserFromRequest } from "../cookies";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const apiKey = getApiKeyFromRequest(request);
  if (!apiKey) {
    return NextResponse.json({ connected: false });
  }
  const user = getUserFromRequest(request);
  // Cookie utilisateur présent mais signature invalide (falsifié/corrompu)
  // → considérer déconnecté plutôt que de retomber sur un pseudo générique.
  if (!user && request.cookies.get("postman_user")?.value) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({
    connected: true,
    user: user ?? { username: "postman-user" },
  });
}
