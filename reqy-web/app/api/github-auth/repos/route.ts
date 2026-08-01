export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { buildGithubHeaders } from "@/lib/github-auth/headers";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const GITHUB_REPOS_URL =
  "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member";

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = request.cookies.get("github_token")?.value;
  if (!token) {
    return NextResponse.json({ connected: false, repos: [] }, { status: 401 });
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    response = await fetch(GITHUB_REPOS_URL, {
      headers: buildGithubHeaders(token),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch {
    return NextResponse.json({ connected: false, repos: [] }, { status: 502 });
  }

  if (!response.ok) {
    const nextResponse = NextResponse.json({ connected: false, repos: [] }, { status: 401 });
    nextResponse.cookies.delete("github_token");
    return nextResponse;
  }

  const repos: unknown = await response.json();
  const repoList = Array.isArray(repos) ? repos : [];
  const normalized = repoList.map((repo: unknown) => {
    const r = repo as Record<string, unknown>;
    return {
      id: r.id,
      full_name: r.full_name,
      name: r.name,
      owner: r.owner ? { login: (r.owner as Record<string, unknown>).login as string } : undefined,
      html_url: r.html_url,
      description: r.description,
      default_branch: r.default_branch,
    } as Record<string, unknown>;
  });

  return NextResponse.json({ connected: true, repos: normalized });
}
