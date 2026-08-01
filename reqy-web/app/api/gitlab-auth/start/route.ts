export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const GITLAB_AUTH_URL = "https://gitlab.com/oauth/authorize";
const CLIENT_ID = process.env.GITLAB_OAUTH_CLIENT_ID;

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!CLIENT_ID) {
    return NextResponse.json({ message: "GITLAB_OAUTH_CLIENT_ID manquant" }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/gitlab-auth/callback`;
  const state = crypto.randomUUID();

  const gitlabUrl = new URL(GITLAB_AUTH_URL);
  gitlabUrl.searchParams.set("client_id", CLIENT_ID);
  gitlabUrl.searchParams.set("redirect_uri", redirectUri);
  gitlabUrl.searchParams.set("scope", "read_api read_user read_repository");
  gitlabUrl.searchParams.set("state", state);
  gitlabUrl.searchParams.set("response_type", "code");

  const response = NextResponse.redirect(gitlabUrl);
  response.cookies.set("gitlab_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
    sameSite: "lax",
  });

  return response;
}
