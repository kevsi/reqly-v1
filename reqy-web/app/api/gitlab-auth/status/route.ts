export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const GITLAB_USER_URL = "https://gitlab.com/api/v4/user";

function buildGitlabHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = request.cookies.get("gitlab_token")?.value;
  if (!token) {
    return NextResponse.json({ connected: false });
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    response = await fetch(GITLAB_USER_URL, {
      headers: buildGitlabHeaders(token),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch {
    return NextResponse.json({ connected: false });
  }

  if (!response.ok) {
    const nextResponse = NextResponse.json({ connected: false });
    nextResponse.cookies.delete("gitlab_token");
    return nextResponse;
  }

  const user = await response.json();
  return NextResponse.json({
    connected: true,
    user: { login: user.username, name: user.name, avatar_url: user.avatar_url },
  });
}
