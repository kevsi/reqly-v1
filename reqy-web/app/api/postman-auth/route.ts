export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { validatePostmanApiKey, PostmanApiError } from "@/lib/postman";
import { buildApiKeyCookie, buildUserCookie, buildClearCookies } from "./cookies";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const API_KEY_REGEX = /^PMAK-[A-Za-z0-9_-]+$/;

export async function POST(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey || !API_KEY_REGEX.test(apiKey)) {
    return NextResponse.json(
      { error: "Clé API invalide (doit commencer par PMAK-)" },
      { status: 400 },
    );
  }

  try {
    const user = await validatePostmanApiKey(apiKey);
    const response = NextResponse.json({ connected: true, user });
    response.cookies.set(buildApiKeyCookie(apiKey));
    response.cookies.set(buildUserCookie(user));
    return response;
  } catch (err) {
    if (err instanceof PostmanApiError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Erreur inattendue" }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  for (const cookie of buildClearCookies()) {
    response.cookies.set(cookie);
  }
  return response;
}
