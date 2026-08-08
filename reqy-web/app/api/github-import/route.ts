export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import {
  formatZodError,
  githubImportBodySchema,
  githubImportResponseSchema,
} from "@/lib/import-schemas";
import {
  type DetectedRoute,
  detectLanguage,
  detectFramework,
  detectRoutes,
  detectPort,
  defaultPortForFramework,
  detectNextJsRoutesFromTree,
  detectNextjsAppRouter,
  detectNextjsPagesRouter,
  analyzeHandlerBody,
  isNonRouteFile,
  IGNORED_FOLDERS,
} from "@/lib/detect-shared";

const MAX_FILES = 200;
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const FETCH_TIMEOUT = 15000;

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

function getRateLimitKey(request: NextRequest): string {
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
  }
  return "unknown";
}

const LANGUAGE_EXTENSION_MAP_FETCH: Record<string, string[]> = {
  JavaScript: ["js", "jsx", "ts", "tsx"],
  Python: ["py"],
  PHP: ["php"],
  Go: ["go"],
  Java: ["java"],
  Ruby: ["rb"],
  CSharp: ["cs"],
  Kotlin: ["kt", "kts"],
  Swift: ["swift"],
  Rust: ["rs"],
};

function getGithubHeaders(token?: string) {
  const authToken = token?.trim() || GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "api-playground",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

export async function POST(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ message: "Rate limit exceeded" }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON in request body" }, { status: 400 });
  }

  try {
    const bodyResult = githubImportBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return NextResponse.json({ message: formatZodError(bodyResult.error) }, { status: 400 });
    }
    const { owner, repo, branch, githubToken } = bodyResult.data;
    const githubCookieToken = request.cookies.get("github_token")?.value;
    const token = githubToken?.trim() || githubCookieToken;

    const defaultBranch = branch || (await getDefaultBranch(owner, repo, token));

    // 1. Fetch Git Tree (all paths instantly)
    const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
    const treeController = new AbortController();
    const treeTimeout = setTimeout(() => treeController.abort(), FETCH_TIMEOUT);
    const treeRes = await fetch(treeUrl, {
      headers: getGithubHeaders(token),
      signal: treeController.signal,
    }).finally(() => clearTimeout(treeTimeout));
    if (!treeRes.ok) {
      if (treeRes.status === 403) throw new Error("GitHub access denied or rate limit reached");
      throw new Error("Failed to fetch repository tree");
    }

    const treeData = (await treeRes.json()) as { tree?: Array<{ type?: string; path?: string }> };
    const treePaths: string[] = (treeData.tree ?? [])
      .filter(
        (t): t is { type: string; path: string } => t.type === "blob" && typeof t.path === "string",
      )
      .map((t) => t.path);

    let framework = "unknown";
    let language = "Unknown";
    let routes: DetectedRoute[] = [];

    // 2. Priority: package.json / requirements.txt / go.mod parsing
    const frameworkDetectMap: Record<string, string> = {
      next: "nextjs",
      "@nestjs/core": "nestjs",
      "@nestjs/common": "nestjs",
      express: "express",
      fastify: "fastify",
      koa: "koa",
      "@hapi/hapi": "hapi",
      hapi: "hapi",
    };
    const packageJsonPath = treePaths.find((p) => p === "package.json");
    if (packageJsonPath) {
      const pkgContent = await fetchFileContentRaw(
        owner,
        repo,
        defaultBranch,
        packageJsonPath,
        token,
      );
      if (pkgContent) {
        try {
          const pkg: unknown = JSON.parse(pkgContent);
          if (typeof pkg !== "object" || pkg === null) throw new Error("Invalid package.json");
          const pkgObj = pkg as Record<string, unknown>;
          const deps: Record<string, unknown> = {
            ...(typeof pkgObj.dependencies === "object" && pkgObj.dependencies !== null
              ? (pkgObj.dependencies as Record<string, unknown>)
              : {}),
            ...(typeof pkgObj.devDependencies === "object" && pkgObj.devDependencies !== null
              ? (pkgObj.devDependencies as Record<string, unknown>)
              : {}),
          };
          for (const [dep, fw] of Object.entries(frameworkDetectMap)) {
            if (deps[dep]) {
              framework = fw;
              break;
            }
          }
          if (deps["typescript"] || deps["react"] || deps["express"]) language = "JavaScript";
        } catch {
          // ignore malformed package.json
        }
      }
    }

    // Also check other config files for non-JS frameworks
    if (framework === "unknown") {
      if (
        treePaths.some(
          (p) => p === "requirements.txt" || p === "setup.py" || p === "pyproject.toml",
        )
      ) {
        language = "Python";
      } else if (treePaths.some((p) => p === "go.mod")) {
        language = "Go";
      } else if (treePaths.some((p) => p === "Gemfile" || p.endsWith(".gemspec"))) {
        language = "Ruby";
      } else if (treePaths.some((p) => p === "composer.json")) {
        language = "PHP";
      } else if (treePaths.some((p) => p === "Cargo.toml")) {
        language = "Rust";
      } else if (
        treePaths.some((p) => p === "build.gradle" || p === "build.gradle.kts" || p === "pom.xml")
      ) {
        language = "Java";
      }
    }

    // 3. Fast-path: Next.js Routing from tree paths only
    if (framework === "nextjs") {
      routes = detectNextJsRoutesFromTree(treePaths);
    }

    // 4. Full analysis: download files
    const validPaths = treePaths.filter((p) => {
      const parts = p.toLowerCase().split("/");
      if (parts.some((part) => IGNORED_FOLDERS.includes(part))) return false;
      if (isNonRouteFile(p)) return false;
      const ext = p.split(".").pop()?.toLowerCase() || "";
      return new Set(Object.values(LANGUAGE_EXTENSION_MAP_FETCH).flat()).has(ext);
    });

    const filesToFetch = validPaths.slice(0, MAX_FILES);
    const decodedFiles: { path: string; content: string }[] = [];

    // Fetch in parallel batches
    const batchSize = 15;
    for (let i = 0; i < filesToFetch.length; i += batchSize) {
      const batch = filesToFetch.slice(i, i + batchSize);
      const contents = await Promise.all(
        batch.map((p) => fetchFileContentRaw(owner, repo, defaultBranch, p, token)),
      );
      batch.forEach((p, idx) => {
        if (contents[idx]) decodedFiles.push({ path: p, content: contents[idx]! });
      });
    }

    if (language === "Unknown") language = detectLanguage(decodedFiles);
    if (framework === "unknown" || framework === "nextjs") {
      // Run full framework detection on downloaded content
      const detectedFw = detectFramework(decodedFiles);
      if (detectedFw !== "unknown") framework = detectedFw;
    }
    const port = detectPort(decodedFiles) ?? defaultPortForFramework(framework);

    // 5. Run full shared route detection (all 30+ frameworks, rich metadata)
    const allRoutes: DetectedRoute[] = [];
    const seenKeys = new Set<string>();

    // Add Next.js tree-based routes (fast path, "ALL" method)
    for (const r of routes) {
      const key = `${r.method}|${r.path}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allRoutes.push(r);
      }
    }

    // Run full shared detection on downloaded files
    for (const f of decodedFiles) {
      // Try framework-specific detection
      const detected = await detectRoutes(f.content, f.path, framework);

      // Also try Next.js-specific for non-nextjs frameworks (some repos have both)
      const nextjsAppRoutes = detectNextjsAppRouter(f);
      const nextjsPageRoutes = detectNextjsPagesRouter(f);

      for (const r of [...detected, ...nextjsAppRoutes, ...nextjsPageRoutes]) {
        const key = `${r.method}|${r.path}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          r.sourceFile = f.path;
          analyzeHandlerBody(f.content, r);
          allRoutes.push(r);
        }
      }
    }

    // Fallback: if no routes found with specific framework, try generic detection
    if (allRoutes.length === 0) {
      for (const f of decodedFiles) {
        const detected = await detectRoutes(f.content, f.path, "unknown");
        for (const r of detected) {
          const key = `${r.method}|${r.path}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            r.sourceFile = f.path;
            analyzeHandlerBody(f.content, r);
            allRoutes.push(r);
          }
        }
      }
    }

    routes = allRoutes;

    // Build github-style response with enriched data
    const payload = {
      name: repo,
      framework,
      language,
      routes: routes.map((r) => ({
        method: r.method,
        path: r.path,
        sourceFile: r.sourceFile,
        authRequired: r.authRequired,
        authType: r.authType || null,
        bodyType: r.bodyType,
        description: r.description,
        confidence: r.confidence || "LOW",
        controller: r.controller || null,
        middlewareChain: r.middlewareChain || [],
        reasonings: r.reasonings || [],
      })),
      port,
    };

    const validated = githubImportResponseSchema.safeParse(payload);
    if (!validated.success) {
      return NextResponse.json(
        { message: "Invalid GitHub analysis", details: formatZodError(validated.error) },
        { status: 502 },
      );
    }
    return NextResponse.json(validated.data);
  } catch (error) {
    console.error("GitHub import error:", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

async function getDefaultBranch(
  owner: string,
  repo: string,
  githubToken?: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: getGithubHeaders(githubToken),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub access denied or rate limit reached");
    throw new Error("Repository not found or access denied");
  }
  const data = await res.json();
  return data.default_branch || "main";
}

async function fetchFileContentRaw(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  githubToken?: string,
): Promise<string | undefined> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const res = await fetch(url, {
    headers: getGithubHeaders(githubToken),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!res.ok) return undefined;
  const item = await res.json();
  if (item.type === "file" && item.content) {
    return Buffer.from(item.content, "base64").toString("utf-8");
  }
  return undefined;
}
