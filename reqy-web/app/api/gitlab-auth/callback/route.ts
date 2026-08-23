export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

const TRUSTED_PROXY = (): boolean => process.env.TRUSTED_PROXY === "true";

function getRateLimitKey(request: NextRequest): string {
  if (TRUSTED_PROXY()) {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
    return ip;
  }
  return "unknown";
}

const TOKEN_URL = "https://gitlab.com/oauth/token";
const CLIENT_ID = process.env.GITLAB_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GITLAB_OAUTH_CLIENT_SECRET;

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = request.cookies.get("gitlab_oauth_state")?.value;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json(
      { message: "GITLAB_OAUTH_CLIENT_ID ou GITLAB_OAUTH_CLIENT_SECRET manquant" },
      { status: 500 },
    );
  }

  if (!code || !state || !savedState || state !== savedState) {
    const errorRedirect = new URL("/settings#integrations", request.url);
    errorRedirect.searchParams.set("gitlab_auth_error", "Impossible de valider l'état GitLab");
    return NextResponse.redirect(errorRedirect);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ message: "NEXT_PUBLIC_APP_URL is not configured" }, { status: 500 });
  }
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/gitlab-auth/callback`;

  let tokenData: Record<string, unknown>;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    tokenData = await tokenResponse.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.redirect(new URL("/settings#integrations", request.url));
    }
    return NextResponse.redirect(new URL("/settings#integrations", request.url));
  }

  const accessToken =
    typeof tokenData.access_token === "string" ? tokenData.access_token : undefined;

  if (!accessToken) {
    const errorRedirect = new URL("/settings#integrations", request.url);
    errorRedirect.searchParams.set(
      "gitlab_auth_error",
      typeof tokenData.error_description === "string"
        ? tokenData.error_description
        : "Impossible d'obtenir le token GitLab",
    );
    return NextResponse.redirect(errorRedirect);
  }

  const response = NextResponse.redirect(new URL("/settings#integrations", request.url));
  response.cookies.set("gitlab_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
    sameSite: "lax",
  });
  response.cookies.delete("gitlab_oauth_state");

  return response;
}
