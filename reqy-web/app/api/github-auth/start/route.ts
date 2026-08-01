export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!CLIENT_ID) {
    return NextResponse.json({ message: "GITHUB_OAUTH_CLIENT_ID manquant" }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/github-auth/callback`;
  const state = crypto.randomUUID();

  const githubUrl = new URL(GITHUB_AUTH_URL);
  githubUrl.searchParams.set("client_id", CLIENT_ID);
  githubUrl.searchParams.set("redirect_uri", redirectUri);
  githubUrl.searchParams.set("scope", "repo read:user");
  githubUrl.searchParams.set("state", state);
  githubUrl.searchParams.set("allow_signup", "false");

  const response = NextResponse.redirect(githubUrl);
  response.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
    sameSite: "lax",
  });

  return response;
}
