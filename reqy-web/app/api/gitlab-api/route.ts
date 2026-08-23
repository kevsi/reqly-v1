export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import {
  listProjects,
  listRepoTree,
  getFileRawContent,
  detectFileType,
  GitLabApiError,
} from "@/lib/gitlab";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });

function getRateLimitKey(request: NextRequest): string {
  // Mirror /api/proxy: only trust forwarded headers behind a trusted reverse
  // proxy, otherwise use a shared key so header rotation cannot bypass the
  // limiter.
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
  }
  return "unknown";
}

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = request.cookies.get("gitlab_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "GitLab non connecté" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    switch (action) {
      case "projects": {
        const search = searchParams.get("search") || undefined;
        const projects = await listProjects(token, search);
        return NextResponse.json({ projects });
      }

      case "tree": {
        const projectId = Number(searchParams.get("projectId"));
        if (!projectId) {
          return NextResponse.json({ error: "projectId requis" }, { status: 400 });
        }
        const path = searchParams.get("path") || undefined;
        const ref = searchParams.get("ref") || undefined;
        const items = await listRepoTree(token, projectId, path, ref);
        return NextResponse.json({ items });
      }

      case "raw": {
        const projectId = Number(searchParams.get("projectId"));
        const filePath = searchParams.get("filePath");
        const ref = searchParams.get("ref") || undefined;
        if (!projectId || !filePath) {
          return NextResponse.json({ error: "projectId et filePath requis" }, { status: 400 });
        }
        const content = await getFileRawContent(token, projectId, filePath, ref);
        const fileType = detectFileType(filePath);
        return NextResponse.json({ content, fileType });
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof GitLabApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json({ error: "Timeout : GitLab n'a pas répondu" }, { status: 504 });
    }
    return NextResponse.json({ error: "Erreur réseau, réessayez" }, { status: 500 });
  }
}
