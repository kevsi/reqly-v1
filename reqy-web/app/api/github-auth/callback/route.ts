export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getRateLimitKey } from "@/app/api/proxy-ai/lib/rate-limit";
import { assertGithubUrl, safeFetch } from "@/lib/server/safe-fetch";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET;
const SYNC_URL = process.env.SYNC_URL || process.env.NEXT_PUBLIC_SYNC_URL;

export async function GET(request: NextRequest) {
  // SECURITY: key the limiter per client (visitor cookie → IP → anonymous UA),
  // never with a shared literal — a single "github-auth-callback" bucket let
  // one client saturate the 30 req/min budget and lock out every other user's
  // OAuth login (DoS) while providing no per-attacker limiting.
  const rateResult = await rateLimiter.check(getRateLimitKey(request));
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Base for user-facing redirects. request.url can resolve to a dead
  // origin (e.g. http://0.0.0.0:3000) when Next binds to all interfaces
  // behind a reverse proxy, producing unreachable Location headers.
  const redirectBase = process.env.NEXT_PUBLIC_APP_URL || request.url;

  // Determine purpose: login or tool integration
  const loginState = request.cookies.get("github_login_state")?.value;
  const toolState = request.cookies.get("github_oauth_state")?.value;
  const isLogin = !!loginState;
  const savedState = loginState || toolState;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    const errUrl = isLogin
      ? new URL("/login?error=github_not_configured", redirectBase)
      : new URL("/settings#integrations", redirectBase);
    return NextResponse.redirect(errUrl);
  }

  if (!code || !state || !savedState || state !== savedState) {
    const errUrl = isLogin
      ? new URL("/login?error=github_state_invalid", redirectBase)
      : new URL("/settings#integrations", redirectBase);
    if (!isLogin)
      errUrl.searchParams.set("github_auth_error", "Impossible de valider l'état GitHub");
    return NextResponse.redirect(errUrl);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ message: "NEXT_PUBLIC_APP_URL is not configured" }, { status: 500 });
  }
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/github-auth/callback`;

  // Exchange code for access token
  let tokenData: Record<string, unknown>;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const tokenResponse = await safeFetch(assertGithubUrl(TOKEN_URL), {
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
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    tokenData = await tokenResponse.json();
  } catch {
    const errUrl = isLogin
      ? new URL("/login?error=github_token_failed", redirectBase)
      : new URL("/settings#integrations", redirectBase);
    return NextResponse.redirect(errUrl);
  }

  const accessToken =
    typeof tokenData.access_token === "string" ? tokenData.access_token : undefined;

  if (!accessToken) {
    const errUrl = isLogin
      ? new URL("/login?error=github_token_failed", redirectBase)
      : new URL("/settings#integrations", redirectBase);
    if (!isLogin) {
      errUrl.searchParams.set(
        "github_auth_error",
        typeof tokenData.error_description === "string"
          ? tokenData.error_description
          : "Impossible d'obtenir le token GitHub",
      );
    }
    return NextResponse.redirect(errUrl);
  }

  // ── LOGIN FLOW ────────────────────────────────────────────────────────────
  if (isLogin) {
    // Fetch GitHub user profile
    let githubUser: { id: number; login: string; email: string | null; name: string | null };
    try {
      const userResponse = await safeFetch(assertGithubUrl("https://api.github.com/user"), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      githubUser = await userResponse.json();
      if (!githubUser.id || !githubUser.login) {
        return NextResponse.redirect(new URL("/login?error=github_profile_failed", redirectBase));
      }
    } catch {
      return NextResponse.redirect(new URL("/login?error=github_profile_failed", redirectBase));
    }

    // Fetch primary email if not public
    let email = githubUser.email;
    if (!email) {
      try {
        const emailsResponse = await safeFetch(assertGithubUrl("https://api.github.com/user/emails"), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });
        const emails = await emailsResponse.json();
        const primary = emails.find(
          (e: { primary: boolean; verified: boolean }) => e.primary && e.verified,
        );
        email = primary?.email || emails.find((e: { verified: boolean }) => e.verified)?.email;
      } catch {
        // Continue without email
      }
    }

    if (!email) {
      return NextResponse.redirect(new URL("/login?error=github_no_email", redirectBase));
    }

    // Register/login on sync-server
    if (!SYNC_URL) {
      return NextResponse.redirect(new URL("/login?error=sync_not_configured", redirectBase));
    }

    try {
      // L'URL de sync vient de l'environnement : safeFetch impose
      // http/https, un hôte public et refuse localhost/privé/réservé.
      const syncResponse = await safeFetch(
        `${SYNC_URL.replace(/\/$/, "")}/api/auth/oauth-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "github",
            providerId: String(githubUser.id),
            email,
            name: githubUser.name || githubUser.login,
            // The sync-server validates this token against api.github.com/user
            // before issuing a session.
            accessToken,
          }),
        },
      );

      if (!syncResponse.ok) {
        const err = await syncResponse.json().catch(() => ({}));
        return NextResponse.redirect(
          new URL(`/login?error=${encodeURIComponent(err.error || "sync_failed")}`, redirectBase),
        );
      }

      const { token } = await syncResponse.json();

      const response = NextResponse.redirect(new URL("/", redirectBase));
      response.cookies.set("auth_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
        sameSite: "lax",
      });
      response.cookies.delete("github_login_state");
      return response;
    } catch {
      return NextResponse.redirect(new URL("/login?error=sync_failed", redirectBase));
    }
  }

  // ── TOOL INTEGRATION FLOW (existing behavior) ─────────────────────────────
  const response = NextResponse.redirect(new URL("/settings#integrations", redirectBase));
  response.cookies.set("github_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
    sameSite: "lax",
  });
  response.cookies.delete("github_oauth_state");

  return response;
}
