export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;

export async function GET(request: NextRequest) {
  const rateResult = await rateLimiter.check("github-login");
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!CLIENT_ID) {
    const base = process.env.NEXT_PUBLIC_APP_URL || request.url;
    return NextResponse.redirect(new URL("/login?error=github_not_configured", base));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  // Reuse the SAME redirect URI as the existing GitHub tool integration
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/github-auth/callback`;
  const state = crypto.randomUUID();

  const githubUrl = new URL(GITHUB_AUTH_URL);
  githubUrl.searchParams.set("client_id", CLIENT_ID);
  githubUrl.searchParams.set("redirect_uri", redirectUri);
  githubUrl.searchParams.set("scope", "read:user user:email");
  githubUrl.searchParams.set("state", state);
  githubUrl.searchParams.set("allow_signup", "false");

  const response = NextResponse.redirect(githubUrl);
  // Store state with "login" purpose — the callback checks this cookie
  response.cookies.set("github_login_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
    sameSite: "lax",
  });

  return response;
}
