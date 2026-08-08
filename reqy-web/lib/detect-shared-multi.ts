/**
 * Multi-language / miscellaneous framework detectors:
 * Go, Rust (Actix, Axum, Rocket), Swift, ASP.NET, Laravel, Rails, Phoenix, Servant, Sinatra, Haskell.
 */

import type { DetectedRoute } from "@/lib/detect-shared-types";
import { makeRoute, normalizePath } from "@/lib/detect-shared-types";

// ── Local addRoute helper ──────────────────────────────────────────────────

function addRoute(routes: DetectedRoute[], seen: Set<string>, method: string, path: string): void {
  const key = `${method}|${normalizePath(path)}`;
  if (!seen.has(key)) {
    seen.add(key);
    routes.push(makeRoute(method, path, ""));
  }
}

// ── Laravel ────────────────────────────────────────────────────────────────

export function detectLaravel(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];

  const parseMethodList = (text: string): string[] => {
    const list = text.match(/\[\s*(['"][^'"]+['"](?:\s*,\s*['"][^'"]+['"])*?)\s*\]/);
    if (!list) return [];
    return list[1].split(/\s*,\s*/).map((item) => item.replace(/['"\s]/g, "").toUpperCase());
  };

  const parseGroupChain = (chain: string) => {
    const result = { prefix: "", auth: false };
    for (const m of chain.matchAll(/(prefix|middleware)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (m[1] === "prefix") result.prefix = normalizePath(`${result.prefix}${m[2]}`);
      if (m[1] === "middleware" && /auth/.test(m[2])) result.auth = true;
    }
    return result;
  };

  const addLaravelRoute = (method: string, path: string, auth = false, reason = "") => {
    const r = makeRoute(method, normalizePath(path), "");
    if (auth) {
      r.authRequired = true;
      r.authType = "middleware";
      if (reason) r.reasonings?.push(reason);
    }
    routes.push(r);
  };

  const ROUTE_RE = /Route::(get|post|put|delete|patch|any|match)\s*\(([^;]*?)\)\s*;/g;
  for (const m of content.matchAll(ROUTE_RE)) {
    const verb = m[1];
    const args = m[2];
    if (verb === "match") {
      const methods = parseMethodList(args);
      const pathMatch = args.match(/['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
      if (!pathMatch) continue;
      const path = pathMatch[2];
      const auth = /->middleware\s*\(\s*\[?['"][^'"]*auth/.test(args);
      for (const method of methods.length ? methods : ["GET"]) {
        addLaravelRoute(method, path, auth, "Laravel Route::match(...)");
      }
      continue;
    }

    const pathMatch = args.match(/['"]([^'"]+)['"]/);
    if (!pathMatch) continue;
    const path = pathMatch[1];
    const method = verb === "any" ? "GET" : verb.toUpperCase();
    const auth = /->middleware\s*\(\s*\[?['"][^'"]*auth/.test(args);
    addLaravelRoute(method, path, auth, "Laravel ->middleware('auth')");
  }

  const RESOURCE_RE = /Route::(apiResource|resource)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
  for (const m of content.matchAll(RESOURCE_RE)) {
    const base = normalizePath(m[2]);
    const methods = ["GET", "POST", "GET", "PUT", "PATCH", "DELETE"];
    const paths = [base, base, `${base}/:id`, `${base}/:id`, `${base}/:id`, `${base}/:id`];
    for (let i = 0; i < methods.length; i++) {
      addLaravelRoute(methods[i], paths[i], false, `Laravel ${m[1]} route`);
    }
  }

  const GROUP_RE =
    /Route::((?:\s*(?:prefix|middleware)\s*\(\s*['"]([^'"]+)['"]\s*\)\s*->\s*)*)group\s*\(\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of content.matchAll(GROUP_RE)) {
    const chain = m[1];
    const groupBody = m[2];
    const { prefix, auth } = parseGroupChain(chain);
    const INNER = /Route::(get|post|put|delete|patch|any|match)\s*\(([^;]*?)\)\s*;/g;
    for (const inner of groupBody.matchAll(INNER)) {
      const innerVerb = inner[1];
      const innerArgs = inner[2];
      if (innerVerb === "match") {
        const methods = parseMethodList(innerArgs);
        const pathMatch = innerArgs.match(/['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
        if (!pathMatch) continue;
        const path = normalizePath(`${prefix}${pathMatch[2]}`);
        for (const method of methods.length ? methods : ["GET"]) {
          addLaravelRoute(method, path, auth, "Laravel grouped route");
        }
        continue;
      }
      const pathMatch = innerArgs.match(/['"]([^'"]+)['"]/);
      if (!pathMatch) continue;
      const method = innerVerb === "any" ? "GET" : innerVerb.toUpperCase();
      const path = normalizePath(`${prefix}${pathMatch[1]}`);
      addLaravelRoute(method, path, auth, "Laravel grouped route");
    }
  }

  return routes;
}

export function detectLaravelEnhanced(content: string): DetectedRoute[] {
  const result = detectLaravel(content);
  const enhanced: DetectedRoute[] = [];
  const seen = new Set<string>();

  const IMPLICIT_ROUTE_RE = /Route::\w+\s*\(\s*['"]([^'"]+)['"](?:\s*,|\s*,\s*function)/g;
  for (const m of content.matchAll(IMPLICIT_ROUTE_RE)) {
    const path = normalizePath(m[1]);
    const key = `GET|${path}`;
    if (!seen.has(key) && !result.some((r) => r.path === path)) {
      seen.add(key);
      enhanced.push(makeRoute("GET", path, ""));
    }
  }

  for (const r of result) {
    const key = `${r.method}|${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      enhanced.push(r);
    }
  }

  return enhanced;
}

// ── Rails ──────────────────────────────────────────────────────────────────

export function detectRails(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const VERB_RE =
    /\b(get|post|put|patch|delete|resources?|namespace)\s+['"]([^'"]+)['"]([\s\S]{0,200}?)(?=\n\s*(?:get|post|put|patch|delete|resources?|end|namespace)|$)/g;
  for (const m of content.matchAll(VERB_RE)) {
    const verb = m[1];
    const routePath = m[2];
    const opts = m[3] || "";
    if (verb === "resources" || verb === "resource") {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
        routes.push(makeRoute(method, `/${routePath}`, ""));
    } else if (verb === "namespace") {
      routes.push(makeRoute("GET", `/${routePath}`, ""));
    } else {
      const r = makeRoute(verb.toUpperCase(), routePath, "");
      if (/authenticate_user!|before_action\s*:authenticate/.test(opts)) {
        r.authRequired = true;
        r.authType = "middleware";
        r.reasonings?.push("Rails authenticate_user! / before_action :authenticate");
      }
      routes.push(r);
    }
  }
  return routes;
}

export function detectRailsEnhanced(content: string): DetectedRoute[] {
  const result = detectRails(content);
  const enhanced: DetectedRoute[] = [];
  const seen = new Set<string>();

  const REST_RE = /\b(get|post|put|patch|delete)\s+['"]([^'"]+)['"]\s*(?:,\s*to\s*:|=>)/g;
  for (const m of content.matchAll(REST_RE)) {
    const method = m[1].toUpperCase();
    const path = normalizePath(m[2]);
    const key = `${method}|${path}`;
    if (!seen.has(key) && !result.some((r) => r.method === method && r.path === path)) {
      seen.add(key);
      enhanced.push(makeRoute(method, path, ""));
    }
  }

  for (const r of result) {
    const key = `${r.method}|${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      enhanced.push(r);
    }
  }

  return enhanced;
}

// ── Phoenix ────────────────────────────────────────────────────────────────

export function detectPhoenix(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const VERB_RE =
    /\b(get|post|put|patch|delete)\s*\(\s*['"]([^'"\s][^'"]*)['"]\s*,\s*([A-Za-z0-9_.]+)\s*,\s*:?([A-Za-z0-9_]+)?/gi;
  for (const m of content.matchAll(VERB_RE)) {
    const method = m[1].toUpperCase();
    const pathStr = m[2];
    const controller = m[3];
    const action = m[4] || "index";
    const r = makeRoute(method, pathStr, `${controller}#${action}`);
    r.controller = controller;
    const ctx = content.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 200);
    if (
      /pipeline\s*:\s*browser|pipeline\s*:\s*api|pipe_through\s*:\s*\[:?\w+/.test(ctx) &&
      /auth|authenticate|ensure_auth|:browser/.test(ctx)
    ) {
      r.authRequired = true;
      r.authType = "middleware";
      r.reasonings?.push("Pipeline/pipe_through suggerant protection");
    }
    routes.push(r);
  }
  const RES_RE = /\bresources\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_.]+)/gi;
  for (const m of content.matchAll(RES_RE)) {
    const base = m[1];
    const controller = m[2];
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const r = makeRoute(method, `/${base}`, `${controller}#resource`);
      r.controller = controller;
      routes.push(r);
    }
  }
  return routes;
}

// ── Servant (Haskell) ──────────────────────────────────────────────────────

export function detectServant(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const PATH_RE = /"([^"\\]+)"\s*:\s*>/g;
  const seen = new Set<string>();
  for (const m of content.matchAll(PATH_RE)) {
    const seg = m[1];
    const path = `/${seg}`;
    if (!seen.has(path)) {
      seen.add(path);
      routes.push(makeRoute("GET", path, "Servant inferred route"));
    }
  }
  const LIT_RE = /\"([\/][^\"]+)\"/g;
  for (const m of content.matchAll(LIT_RE)) {
    const p = m[1];
    if (p.includes("/") && !seen.has(p)) {
      seen.add(p);
      routes.push(makeRoute("GET", p, "Servant/WAI inferred route"));
    }
  }
  return routes;
}

// ── Haskell enhanced ───────────────────────────────────────────────────────

export function detectHaskellEnhanced(content: string): DetectedRoute[] {
  const result = detectServant(content);
  const enhanced: DetectedRoute[] = [];
  const seen = new Set<string>();

  const SERVANT_RE = /["']\/([^"']+)["']\s*:>/g;
  for (const m of content.matchAll(SERVANT_RE)) {
    const path = normalizePath("/" + m[1]);
    const key = `GET|${path}`;
    if (!seen.has(key) && !result.some((r) => r.path === path)) {
      seen.add(key);
      enhanced.push(makeRoute("GET", path, ""));
    }
  }

  for (const r of result) {
    const key = `${r.method}|${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      enhanced.push(r);
    }
  }

  return enhanced;
}

// ── Sinatra enhanced ───────────────────────────────────────────────────────

export function detectSinatraEnhanced(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  const SINATRA_RE = /(get|post|put|delete|patch|options|head)\s+['"]([^'"]+)['"]\s*(?:do|{|=>)/g;
  for (const m of content.matchAll(SINATRA_RE)) {
    const method = m[1].toUpperCase();
    const path = normalizePath(m[2]);
    const key = `${method}|${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(makeRoute(method, path, ""));
    }
  }

  return routes;
}

// ── Go ─────────────────────────────────────────────────────────────────────

export function detectGo(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const routerVars = new Set<string>();
  const groupPrefix = new Map<string, string>();

  for (const m of content.matchAll(
    /(?:const|var|\w+\s*:=\s*)?\s*(\w+)\s*[=:]\s*(?:gin\.(?:Default|New)|echo\.New|fiber\.New|chi\.NewRouter|mux\.NewRouter|http\.NewServeMux)\s*\(/g,
  )) {
    routerVars.add(m[1]);
  }
  for (const m of content.matchAll(
    /(?:const|var|\w+\s*:=\s*)?\s*(\w+)\s*[=:]\s*(?:gin|echo|fiber|chi|mux)\.(?:Default|New|NewRouter)\s*\(/g,
  )) {
    routerVars.add(m[1]);
  }
  for (const m of content.matchAll(
    /(?:const|var|\w+\s*:=\s*)?\s*(\w+)\s*[=:]\s*(?:\w+)\.(?:Group|Route|GroupFunc)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    routerVars.add(m[1]);
    groupPrefix.set(m[1], m[2]);
  }
  for (const name of ["r", "router", "engine", "mux", "e", "echo", "g", "group", "app", "api"]) {
    routerVars.add(name);
  }

  const isRouter = (obj: string) => routerVars.has(obj);
  const prefixFor = (obj: string) => groupPrefix.get(obj) ?? "";

  const STD_RE = /([A-Za-z_]\w*)\s*\.\s*(HandleFunc|Handle)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;
  for (const m of content.matchAll(STD_RE)) {
    if (isRouter(m[1])) addRoute(routes, seen, "GET", m[3]);
  }

  const GIN_RE =
    /([A-Za-z_]\w*)\s*\.\s*(GET|POST|PUT|DELETE|PATCH|Any|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;
  for (const m of content.matchAll(GIN_RE)) {
    if (isRouter(m[1])) {
      const method = m[2] === "Any" ? "GET" : m[2];
      addRoute(routes, seen, method, normalizePath(`${prefixFor(m[1])}/${m[3]}`));
    }
  }

  const ECHO_RE =
    /([A-Za-z_]\w*)\s*\.\s*(GET|POST|PUT|DELETE|PATCH|Any|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;
  for (const m of content.matchAll(ECHO_RE)) {
    if (isRouter(m[1])) {
      const method = m[2] === "Any" ? "GET" : m[2];
      addRoute(routes, seen, method, normalizePath(`${prefixFor(m[1])}/${m[3]}`));
    }
  }

  const FIBER_RE =
    /([A-Za-z_]\w*)\s*\.\s*(Get|Post|Put|Delete|Patch|All|Head|Options)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;
  for (const m of content.matchAll(FIBER_RE)) {
    if (isRouter(m[1])) {
      const method = m[2] === "All" ? "GET" : m[2].toUpperCase();
      addRoute(routes, seen, method, normalizePath(`${prefixFor(m[1])}/${m[3]}`));
    }
  }

  const CHI_RE =
    /([A-Za-z_]\w*)\s*\.\s*(Get|Post|Put|Delete|Patch|Head|Options|Route)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;
  for (const m of content.matchAll(CHI_RE)) {
    if (isRouter(m[1])) {
      const method = m[2] === "Route" ? "GET" : m[2].toUpperCase();
      addRoute(routes, seen, method, normalizePath(`${prefixFor(m[1])}/${m[3]}`));
    }
  }

  return routes;
}

export function detectGoEnhanced(content: string): DetectedRoute[] {
  const result = detectGo(content);
  const enhanced: DetectedRoute[] = [];
  const seen = new Set<string>();

  const HTTP_RE = /http\.Handle(?:Func)?\s*\(\s*['"]([^'"]+)['"]\s*,/g;
  for (const m of content.matchAll(HTTP_RE)) {
    const path = normalizePath(m[1]);
    const key = `GET|${path}`;
    if (!seen.has(key) && !result.some((r) => r.path === path)) {
      seen.add(key);
      enhanced.push(makeRoute("GET", path, ""));
    }
  }

  for (const r of result) {
    const key = `${r.method}|${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      enhanced.push(r);
    }
  }

  return enhanced;
}

// ── Rust (Actix-web, Axum, Rocket) ─────────────────────────────────────────

export function detectActix(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  const ROUTE_RE = /\.route\s*\(\s*['"]([^'"]+)['"]\s*,\s*web::(get|post|put|delete|patch)\s*\(/g;
  for (const m of content.matchAll(ROUTE_RE)) {
    addRoute(routes, seen, m[2].toUpperCase(), m[1]);
  }

  const RESOURCE_RE = /web::resource\s*\(\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(RESOURCE_RE)) {
    addRoute(routes, seen, "GET", m[1]);
  }

  return routes;
}

export function detectAxum(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  const ROUTE_RE = /\.route\s*\(\s*['"]([^'"]+)['"]\s*,\s*(get|post|put|delete|patch|any)/g;
  for (const m of content.matchAll(ROUTE_RE)) {
    const method = m[2] === "any" ? "GET" : m[2].toUpperCase();
    addRoute(routes, seen, method, m[1]);
  }

  const NEST_RE = /\.nest\s*\(\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(NEST_RE)) {
    addRoute(routes, seen, "GET", m[1]);
  }

  return routes;
}

export function detectRocket(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  const ATTR_RE = /#\[\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(ATTR_RE)) {
    addRoute(routes, seen, m[1].toUpperCase(), m[2]);
  }

  const ROUTES_MACRO = /routes!\s*\[([^\]]+)\]/g;
  for (const m of content.matchAll(ROUTES_MACRO)) {
    for (const route of m[1].split(",").map((s) => s.trim())) {
      if (route) addRoute(routes, seen, "GET", `/${route}`);
    }
  }

  return routes;
}

export function detectRust(content: string): DetectedRoute[] {
  return [...detectActix(content), ...detectAxum(content), ...detectRocket(content)];
}

export function detectRustEnhanced(content: string): DetectedRoute[] {
  const result = detectRust(content);
  const enhanced: DetectedRoute[] = [];
  const seen = new Set<string>();

  const SERVICE_RE = /\.route\s*\(\s*['"]([^'"]+)['"]\s*,\s*web::(get|post|put|delete|patch)\s*\(/g;
  for (const m of content.matchAll(SERVICE_RE)) {
    const path = normalizePath(m[1]);
    const method = m[2].toUpperCase();
    const key = `${method}|${path}`;
    if (!seen.has(key) && !result.some((r) => r.method === method && r.path === path)) {
      seen.add(key);
      enhanced.push(makeRoute(method, path, ""));
    }
  }

  for (const r of result) {
    const key = `${r.method}|${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      enhanced.push(r);
    }
  }

  return enhanced;
}

// ── Swift / Vapor ──────────────────────────────────────────────────────────

export function detectSwift(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  const VAPOR_RE =
    /(?:app|router|routes)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(VAPOR_RE)) {
    addRoute(routes, seen, m[1].toUpperCase(), m[2]);
  }

  const GROUP_RE = /(?:app|router|routes)\s*\.\s*group\s*\(\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(GROUP_RE)) {
    addRoute(routes, seen, "GET", m[1]);
  }

  const REGISTER_RE = /routes\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
  for (const m of content.matchAll(REGISTER_RE)) {
    addRoute(routes, seen, m[1].toUpperCase(), m[2]);
  }

  const KITURA_RE = /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(KITURA_RE)) {
    addRoute(routes, seen, m[1].toUpperCase(), m[2]);
  }

  return routes;
}

export function detectSwiftEnhanced(content: string): DetectedRoute[] {
  const result = detectSwift(content);
  const enhanced: DetectedRoute[] = [];
  const seen = new Set<string>();

  const VAPOR_RE = /app\.(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(VAPOR_RE)) {
    const path = normalizePath(m[1]);
    const key = `GET|${path}`;
    if (!seen.has(key) && !result.some((r) => r.path === path)) {
      seen.add(key);
      enhanced.push(makeRoute("GET", path, ""));
    }
  }

  for (const r of result) {
    const key = `${r.method}|${r.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      enhanced.push(r);
    }
  }

  return enhanced;
}

// ── ASP.NET ────────────────────────────────────────────────────────────────

export function detectAspNet(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const MAP_RE =
    /(?:app|endpoints)\.(MapGet|MapPost|MapPut|MapDelete|MapPatch)\s*\(\s*['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(MAP_RE)) {
    const method = m[1].replace("Map", "").toUpperCase();
    const r = makeRoute(method, m[2], "");
    routes.push(r);
  }
  const ATTR_RE =
    /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*(?:\(\s*['"]([^'"]+)['"]\s*\))?\]/g;
  for (const m of content.matchAll(ATTR_RE)) {
    const method = m[1].replace("Http", "").toUpperCase();
    const subPath = m[2] ?? "";
    const idx = m.index ?? 0;
    const preceding = content.slice(Math.max(0, idx - 300), idx);
    const r = makeRoute(method, subPath || "/", "");
    if (/\[Authorize/.test(preceding)) {
      r.authRequired = true;
      r.authType = "middleware";
      r.reasonings?.push("ASP.NET [Authorize]");
    }
    routes.push(r);
  }
  return routes;
}
