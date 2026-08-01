export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { buildGithubHeaders } from "@/lib/github-auth/headers";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const GITHUB_USER_URL = "https://api.github.com/user";

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = request.cookies.get("github_token")?.value;
  if (!token) {
    return NextResponse.json({ connected: false });
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    response = await fetch(GITHUB_USER_URL, {
      headers: buildGithubHeaders(token),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch {
    return NextResponse.json({ connected: false });
  }

  if (!response.ok) {
    const nextResponse = NextResponse.json({ connected: false });
    nextResponse.cookies.delete("github_token");
    return nextResponse;
  }

  const user = await response.json();
  return NextResponse.json({
    connected: true,
    user: { login: user.login, name: user.name, avatar_url: user.avatar_url },
  });
}
