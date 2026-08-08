/**
 * Orchestration: route detection entry point, framework matching,
 * frontend call scanning, middleware analysis, and dynamic route detection.
 */

import type { DetectedRoute } from "@/lib/detect-shared-types";
import { makeRoute, normalizePath } from "@/lib/detect-shared-types";

// JS/TS framework detectors
import {
  detectExpress,
  detectFastify,
  detectKoa,
  detectHapi,
  detectKtor,
  detectNestJS,
} from "@/lib/detect-shared-js-frameworks";

// Python framework detectors
import {
  detectFastAPI,
  detectFlask,
  detectDjango,
  detectTornado,
  detectSanic,
  detectStarlette,
  detectLitestar,
  detectAiohttp,
  detectFalcon,
} from "@/lib/detect-shared-python";

// Java framework detectors
import { detectSpring, detectMicronaut, detectQuarkus } from "@/lib/detect-shared-java";

// Multi-language framework detectors
import {
  detectLaravelEnhanced,
  detectRailsEnhanced,
  detectPhoenix,
  detectHaskellEnhanced,
  detectSinatraEnhanced,
  detectGoEnhanced,
  detectRustEnhanced,
  detectSwiftEnhanced,
  detectAspNet,
  detectActix,
  detectAxum,
  detectRocket,
} from "@/lib/detect-shared-multi";

// ── Tree-sitter dynamic loading (server-side only) ─────────────────────────

let detectRoutesWithTreeSitter:
  (typeof import("./tree-sitter-parser"))["detectRoutesWithTreeSitter"] | undefined;
let initTreeSitter: (typeof import("./tree-sitter-parser"))["initTreeSitter"] | undefined;

export async function ensureTreeSitterLoaded() {
  if (!detectRoutesWithTreeSitter || !initTreeSitter) {
    if (typeof window === "undefined") {
      const mod = await import("./tree-sitter-parser");
      detectRoutesWithTreeSitter = mod.detectRoutesWithTreeSitter;
      initTreeSitter = mod.initTreeSitter;
    } else {
      throw new Error("tree-sitter-parser cannot be loaded in the browser/client context");
    }
  }
}

// ── Enhancement pipeline ──────────────────────────────────────────────────

function enhanceDetectionResults(
  routes: DetectedRoute[],
  content: string,
  _framework: string,
): DetectedRoute[] {
  void _framework;
  const seen = new Set<string>();
  const deduped: DetectedRoute[] = [];

  for (const route of routes) {
    route.path = normalizePath(route.path);

    const key = `${route.method}|${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!route.authRequired) {
      const authPatterns = [
        /\b(?:auth|authenticate|jwt|token|bearer|oauth|permission|role|guard|middleware)\b/i,
        /401|403|Unauthorized|Forbidden/i,
        /\.isAuth\(|\.checkAuth\(|\.requireAuth\(|\.protected\(|\.private\(/i,
      ];

      for (const pattern of authPatterns) {
        if (pattern.test(content)) {
          route.authRequired = true;
          route.authType = "middleware";
          if (!route.reasonings) route.reasonings = [];
          route.reasonings.push("Possible auth pattern detected");
          break;
        }
      }
    }

    if (!route.confidence) {
      const signals = [
        route.authRequired,
        route.bodyType !== "none",
        route.middlewareChain && route.middlewareChain.length > 0,
        route.description && route.description.length > 0,
        route.reasonings && route.reasonings.length > 0,
      ];
      const signalCount = signals.filter(Boolean).length;
      route.confidence = signalCount >= 3 ? "HIGH" : signalCount >= 1 ? "MEDIUM" : "LOW";
    }

    deduped.push(route);
  }

  return deduped;
}

// ── Route dispatcher ─────────────────────────────────────────────────────

export async function matchFramework(
  content: string,
  framework: string,
  _fp: string,
): Promise<DetectedRoute[]> {
  let routes: DetectedRoute[];

  switch (framework) {
    case "express":
      routes = detectExpress(content);
      break;
    case "nextjs":
      routes = [];
      break;
    case "fastapi":
      routes = detectFastAPI(content);
      break;
    case "flask":
      routes = detectFlask(content);
      break;
    case "django":
      routes = detectDjango(content);
      break;
    case "tornado":
      routes = detectTornado(content);
      break;
    case "sanic":
      routes = detectSanic(content);
      break;
    case "starlette":
      routes = detectStarlette(content);
      break;
    case "litestar":
      routes = detectLitestar(content);
      break;
    case "aiohttp":
      routes = detectAiohttp(content);
      break;
    case "falcon":
      routes = detectFalcon(content);
      break;
    case "nestjs":
      routes = detectNestJS(content);
      break;
    case "laravel":
      routes = detectLaravelEnhanced(content);
      break;
    case "fastify":
      routes = detectFastify(content);
      break;
    case "koa":
      routes = detectKoa(content);
      break;
    case "hapi":
      routes = detectHapi(content);
      break;
    case "kotlin":
      routes = detectKtor(content);
      break;
    case "rails":
      routes = detectRailsEnhanced(content);
      break;
    case "phoenix":
      routes = detectPhoenix(content);
      break;
    case "spring":
      routes = await detectSpring(content);
      break;
    case "micronaut":
      routes = await detectMicronaut(content);
      break;
    case "quarkus":
      routes = await detectQuarkus(content);
      break;
    case "aspnet":
      routes = detectAspNet(content);
      break;
    case "go":
      routes = detectGoEnhanced(content);
      break;
    case "haskell":
      routes = detectHaskellEnhanced(content);
      break;
    case "rust":
      routes = detectRustEnhanced(content);
      break;
    case "swift":
      routes = detectSwiftEnhanced(content);
      break;
    case "sinatra":
      routes = detectSinatraEnhanced(content);
      break;
    case "actix":
      routes = detectActix(content);
      break;
    case "axum":
      routes = detectAxum(content);
      break;
    case "rocket":
      routes = detectRocket(content);
      break;
    default:
      routes = [
        ...detectExpress(content),
        ...detectFastify(content),
        ...detectKoa(content),
        ...detectHapi(content),
        ...detectFastAPI(content),
        ...detectFlask(content),
        ...detectDjango(content),
        ...detectTornado(content),
        ...detectSanic(content),
        ...detectStarlette(content),
        ...detectLitestar(content),
        ...detectAiohttp(content),
        ...detectFalcon(content),
        ...detectNestJS(content),
        ...detectLaravelEnhanced(content),
        ...detectRailsEnhanced(content),
        ...detectPhoenix(content),
        ...(await detectSpring(content)),
        ...(await detectMicronaut(content)),
        ...(await detectQuarkus(content)),
        ...detectKtor(content),
        ...detectAspNet(content),
        ...detectGoEnhanced(content),
        ...detectHaskellEnhanced(content),
        ...detectRustEnhanced(content),
        ...detectSwiftEnhanced(content),
        ...detectSinatraEnhanced(content),
      ];
  }

  return enhanceDetectionResults(routes, content, framework);
}

// ── Main detectRoutes entry point ─────────────────────────────────────────

export async function detectRoutes(
  content: string,
  filePath: string,
  framework: string,
): Promise<DetectedRoute[]> {
  try {
    await ensureTreeSitterLoaded();
    const tsRoutes = await detectRoutesWithTreeSitter!(content, filePath, framework);
    if (tsRoutes.length > 0) {
      return tsRoutes.map((r) => {
        const route = makeRoute(r.method, r.path, r.name || "");
        if (r.controller) route.controller = r.controller;
        if (r.authRequired) {
          route.authRequired = true;
          route.authType = "jwt";
        }
        return route;
      });
    }
    console.debug(`[tree-sitter] no routes for ${filePath} (${framework}) — falling back to regex`);
  } catch (e) {
    console.debug(
      `[tree-sitter] unavailable for ${filePath} (${framework}): ${e instanceof Error ? e.message : e}`,
    );
  }

  const raw = await matchFramework(content, framework, filePath);
  const seen = new Set<string>();
  return raw.filter((r) => {
    const key = `${r.method}|${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Frontend API call scanning ──────────────────────────────────────────

export function scanFrontendApiCalls(files: { path: string; content: string }[]): Set<string> {
  const calledPaths = new Set<string>();
  const patterns: RegExp[] = [
    /\bfetch\s*\(\s*(['"`])([^'"`\n]+)\1/g,
    /\baxios\.(?:get|post|put|delete|patch|request)\s*\(\s*(['"`])([^'"`\n]+)\1/g,
    /\bky(?:\.(?:get|post|put|delete|patch))?\s*\(\s*(['"`])([^'"`\n]+)\1/g,
    /\$fetch\s*\(\s*(['"`])([^'"`\n]+)\1/g,
    /\buseFetch\s*\(\s*(['"`])([^'"`\n]+)\1/g,
    /\buseSWR\s*\(\s*(['"`])([^'"`\n]+)\1/g,
    /useQuery\s*\(\s*\[\s*(['"`])([^'"`\n]+)\1/g,
    /\baxios\s*\(\s*\{\s*url\s*:\s*(['"`])([^'"`\n]+)\1/g,
    /url\s*:\s*(['"`])([^'"`\n]+)\1/g,
  ];
  for (const file of files) {
    const content = file.content;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(content)) !== null) {
        const called = m[2];
        if (called && called.length > 1 && (called.startsWith("/") || called.startsWith("http"))) {
          const normalized = normalizePath(
            called.startsWith("http") ? called.replace(/^https?:\/\/[^/]+/, "") : called,
          );
          if (normalized && normalized !== "/") {
            calledPaths.add(normalized);
            const withWildcard = normalized.replace(/\$\{[^}]+\}/g, "*");
            if (withWildcard !== normalized) calledPaths.add(withWildcard);
          }
        }
      }
    }
    for (const m of content.matchAll(/\$\{[A-Za-z_$][\w$]*\}([/a-z0-9_-]+)/gi)) {
      if (m[1]) calledPaths.add(normalizePath(m[1]));
    }
  }
  return calledPaths;
}

export function correlateWithFrontendCall(routePath: string, frontendCall: string): boolean {
  if (frontendCall === routePath) return true;
  if (frontendCall.endsWith(routePath)) return true;
  if (routePath.includes(frontendCall)) return true;
  const routeRegex = new RegExp(
    "^" + routePath.replace(/:[a-zA-Z_]\w*\*/g, ".+").replace(/:[a-zA-Z_]\w*/g, "[^/]+") + "$",
  );
  if (routeRegex.test(frontendCall)) return true;
  const normRoute = routePath.replace(/:[a-zA-Z_]\w*/g, "*");
  const normFrontend = frontendCall.replace(/\/\d+/g, "/*");
  if (normRoute === normFrontend) return true;
  return false;
}

// ── Next.js tree-based detection (for GitHub import) ────────────────────

export function detectNextJsRoutesFromTree(paths: string[]): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  for (const p of paths) {
    let match = p.match(/(?:^|\/)app\/api\/(.+)\/route\.(ts|js|mjs)$/);
    if (match) {
      routes.push(makeRoute("GET", `/api/${match[1]}`, ""));
      continue;
    }
    match = p.match(/(?:^|\/)pages\/api\/(.+)\.(ts|js|mjs)$/);
    if (match) {
      let path = `/api/${match[1]}`;
      if (path.endsWith("/index")) path = path.replace(/\/index$/, "");
      routes.push(makeRoute("GET", path, ""));
    }
  }
  return routes;
}

// ── Entry point detection ───────────────────────────────────────────────

export function findEntryPoint(files: { path: string; content: string }[]): string | null {
  const paths = files.map((f) => f.path.replace(/\\/g, "/"));

  const pkgFile = files.find((f) => f.path.endsWith("package.json"));
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (pkg.main || pkg.bin) {
        const mainPath = pkg.main || Object.values(pkg.bin || {})[0];
        if (mainPath) {
          const found = files.find((f) => f.path.replace(/\\/g, "/").endsWith(mainPath as string));
          if (found) return found.path;
        }
      }
    } catch {}
  }

  const entryPatterns = [
    /^(.*\/)?(server|index|app|main)\.(ts|js|mjs)$/,
    /^(.*\/)?src\/(server|index|app|main)\.(ts|js)$/,
    /^(.*\/)?(src\/)?index\.ts$/,
    /^(.*\/)?dist\/index\.js$/,
    /^(.*\/)?(main|app|server|wsgi|asgi)\.py$/,
    /^(.*\/)?src\/(main|app|server)\.py$/,
    /^(.*\/)?main\.go$/,
    /^(.*\/)?src\/main\.rs$/,
    /^(.*\/)?(app|config\.ru)$/,
    /^(.*\/)?Main\.java$/,
    /^(.*\/)?Application\.java$/,
  ];

  for (const pattern of entryPatterns) {
    const match = paths.find((p) => pattern.test(p));
    if (match) return match;
  }

  return null;
}

// ── Middleware chain analysis ──────────────────────────────────────────

export function analyzeMiddlewareChain(
  files: { path: string; content: string }[],
  framework: string,
): Map<string, string[]> {
  const middlewareByRoute = new Map<string, string[]>();
  const globalMiddleware: string[] = [];

  if (framework === "express" || framework === "fastify" || framework === "koa") {
    for (const file of files) {
      const content = file.content;

      const MIDDLEWARE_RE =
        /(?:app|server)\s*\.\s*use\s*\(\s*(?:["']([^"']+)["']\s*,\s*)?([A-Za-z_]\w*)\s*\)/g;
      for (const m of content.matchAll(MIDDLEWARE_RE)) {
        const path = m[1] || "/";
        const middlewareName = m[2];
        if (path === "/") {
          globalMiddleware.push(middlewareName);
        } else {
          const key = `${path}|*`;
          middlewareByRoute.set(key, [...(middlewareByRoute.get(key) || []), middlewareName]);
        }
      }

      const ROUTE_MIDDLEWARE_RE =
        /app\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([\w\s,]+)\s*,\s*(?:async\s+)?(?:function|\([^)]*\)|=>)/g;
      for (const m of content.matchAll(ROUTE_MIDDLEWARE_RE)) {
        const path = m[1];
        const middlewares = m[2].split(",").map((s) => s.trim());
        middlewareByRoute.set(path, middlewares);
      }
    }
  } else if (framework === "django") {
    for (const file of files) {
      if (!file.path.includes("settings")) continue;
      const MIDDLEWARE_RE = /MIDDLEWARE\s*=\s*\[([\s\S]*?)\]/;
      const match = file.content.match(MIDDLEWARE_RE);
      if (match) {
        const middlewares = match[1].match(/['"]([^'"]+)['"]/g) || [];
        middlewares.forEach((m) => globalMiddleware.push(m.replace(/["']/g, "")));
      }
    }
  }

  // Surface global (unscoped) middleware under the "/|*" key — it was
  // previously collected but never returned to callers.
  if (globalMiddleware.length > 0) {
    middlewareByRoute.set("/|*", globalMiddleware);
  }

  return middlewareByRoute;
}

// ── Dynamic routes detection ──────────────────────────────────────────

export function detectDynamicRoutes(files: { path: string; content: string }[]): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const content = file.content;

    const ROUTE_ARRAY_RE =
      /const\s+\w+\s*=\s*\[([\s\S]*?)\]\s*;?\s*(?:\/\/|[\n\r])\s*(?:\.forEach|\.map|\.for)\s*\(\s*(?:async\s+)?\(?\s*\w+\s*\)?\s*=>\s*(?:app|server)\s*\.\s*(?:get|post|put|delete|patch)/g;
    for (const m of content.matchAll(ROUTE_ARRAY_RE)) {
      const arrayContent = m[1];
      const pathMatches = arrayContent.match(/['"]([^'"]+)['"]/g) || [];
      for (const pathMatch of pathMatches) {
        const path = pathMatch.replace(/['\"]/g, "");
        const key = `*|${path}`;
        if (!seen.has(key)) {
          seen.add(key);
          const route = makeRoute("GET", path, "");
          route.reasonings = ["Dynamic route detected (generated from array)"];
          route.confidence = "MEDIUM";
          routes.push(route);
        }
      }
    }

    const DYNAMIC_METHOD_RE =
      /for\s*\(\s*(?:const|var)\s+(\w+)\s+in\s+(\w+)\s*\)\s*\{\s*(?:app|server)\s*\[\s*\1\s*\]\s*\(\s*['"]([^'"]+)['"]/g;
    for (const m of content.matchAll(DYNAMIC_METHOD_RE)) {
      const path = m[3];
      const key = `*|${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        const route = makeRoute("GET", path, "");
        route.reasonings = ["Dynamic route (generated from method iteration)"];
        route.confidence = "MEDIUM";
        routes.push(route);
      }
    }

    const CONDITIONAL_ROUTE_RE =
      /if\s*\(\s*(?:process\.env|config)\.\w+\s*\)\s*\{\s*(?:app|server)\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
    for (const m of content.matchAll(CONDITIONAL_ROUTE_RE)) {
      const path = m[1];
      const key = `?|${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        const route = makeRoute("GET", path, "");
        route.reasonings = ["Conditional route (may not always exist)"];
        route.confidence = "LOW";
        routes.push(route);
      }
    }
  }

  return routes;
}
