/**
 * Python framework detectors (FastAPI, Flask, Django, Tornado, Sanic, Starlette, Litestar, Aiohttp, Falcon)
 * plus Python AST subprocess-based route detection.
 */

import type { DetectedRoute } from "@/lib/detect-shared-types";
import {
  makeRoute,
  normalizePath,
  stripLanguageCommentsAndStrings,
} from "@/lib/detect-shared-types";
import { detectAuthByStatusSignal, parseMethodList } from "@/lib/detect-shared-handler";

// ── FastAPI ─────────────────────────────────────────────────────────────────

export function detectFastAPI(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "fastapi");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const routerPrefixMap = new Map<string, string>();

  const APIRouter_PREFIX_RE =
    /([A-Za-z_][\w]*)\s*=\s*APIRouter\s*\(\s*(?:[^)]*\s+)?prefix\s*[:=]\s*['\"]([^'\"]+)['\"][\s\S]*?\)/g;
  for (const m of sanitized.matchAll(APIRouter_PREFIX_RE)) {
    routerPrefixMap.set(m[1], m[2]);
  }

  const INCLUDE_ROUTER_RE =
    /\.include_router\s*\(\s*([A-Za-z_][\w]*)\s*(?:,\s*prefix\s*=\s*['\"]([^'\"]+)['\"])?/g;
  for (const m of sanitized.matchAll(INCLUDE_ROUTER_RE)) {
    const routerName = m[1];
    const includePrefix = m[2];
    const existing = routerPrefixMap.get(routerName);
    const prefixToSet = includePrefix
      ? existing
        ? normalizePath(`${includePrefix}/${existing}`)
        : includePrefix
      : existing;
    if (prefixToSet) routerPrefixMap.set(routerName, prefixToSet);
  }

  const FASTAPI_RE =
    /@([A-Za-z_][\w]*)\s*\.\s*(?:get|post|put|delete|patch|options|head)\s*\(\s*(['"`])((?:[^'"`\\]|\\.|[\s\S])*?)\3\s*,?([\s\S]*?)(?=\n\s*@|\n\s*(?:async\s+)?def\s|$)/gi;
  for (const m of sanitized.matchAll(FASTAPI_RE)) {
    const target = m[1];
    const method =
      m[0].match(/\.(get|post|put|delete|patch|options|head)/i)?.[1]?.toUpperCase() || "GET";
    const routePath = m[3];
    const decoratorArgs = m[4] || "";

    const r = makeRoute(method as DetectedRoute["method"], routePath, "");
    r.controller = target;

    const hasDependsAuth =
      /Depends\s*\(\s*(?:get_current_user|oauth2_scheme|verify_token|auth|jwt|token)/i.test(
        decoratorArgs,
      ) ||
      /dependencies\s*=\s*\[.*?Depends\s*\(\s*(?:get_current_user|oauth2_scheme|verify_token|auth|jwt|token)/i.test(
        decoratorArgs,
      );
    if (hasDependsAuth) {
      r.authRequired = true;
      r.authType = "jwt";
      r.reasonings?.push("FastAPI Depends() auth detected");
    }

    if (/response_model\s*=/.test(decoratorArgs)) r.reasonings?.push("response_model specified");
    if (/status_code\s*=/.test(decoratorArgs)) r.reasonings?.push("status_code specified");

    const after = sanitized.slice((m.index ?? 0) + m[0].length);
    const fnMatch = after.match(/\n\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/m);
    const params = fnMatch?.[1] ?? "";

    if (params) {
      if (/\bUploadFile\b/.test(params)) {
        r.bodyType = "form";
        r.reasonings?.push("UploadFile detected");
      } else if (/\bFile\s*\(/.test(params)) {
        r.bodyType = "form";
        r.reasonings?.push("File(...) detected");
      } else if (/\bForm\s*\(/.test(params)) {
        r.bodyType = "form";
        r.reasonings?.push("Form(...) detected");
      } else if (
        !/\bQuery\s*\(|\bPath\s*\(|\bDepends\s*\(|\bHeader\s*\(/.test(params) &&
        /:\s*[A-Za-z_][\w.<>\[\]]*/.test(params)
      ) {
        r.bodyType = "json";
        r.reasonings?.push("Body JSON detected");
      }

      if (
        /Depends\s*\(\s*(?:get_current_user|oauth2_scheme|verify_token|auth|jwt|token)/i.test(
          params,
        )
      ) {
        r.authRequired = true;
        r.authType = "jwt";
        r.reasonings?.push("FastAPI Depends() in signature");
      }
    }

    const routerPrefix = routerPrefixMap.get(target);
    if (routerPrefix) r.path = normalizePath(`${routerPrefix}/${r.path}`);

    detectAuthByStatusSignal(content, r);
    const key = `${r.method}|${r.path}`;
    if (!routes.some((route) => `${route.method}|${route.path}` === key)) {
      routes.push(r);
    }
  }

  const SIMPLE_RE =
    /@(?:router|app)\s*\.\s*(?:get|post|put|delete|patch|options|head)\s*\(\s*['"]([^'"]+)['"]/gi;
  const seenKeys = new Set(routes.map((r) => `${r.method}|${r.path}`));
  for (const m of sanitized.matchAll(SIMPLE_RE)) {
    const method =
      m[0].match(/\.(get|post|put|delete|patch|options|head)/i)?.[1]?.toUpperCase() || "GET";
    const path = normalizePath(m[1]);
    const key = `${method}|${path}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      const r = makeRoute(method as DetectedRoute["method"], path, "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }

  return routes;
}

// ── Flask ───────────────────────────────────────────────────────────────────

export function detectFlask(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "flask");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const blueprintPrefix = new Map<string, string>();
  const methodViewMethods = new Map<string, string[]>();
  const REGISTER_BP_RE =
    /app\.register_blueprint\s*\(\s*([A-Za-z_][\w]*)\s*,\s*url_prefix\s*=\s*['\"]([^'\"]+)['\"]\s*\)/g;
  for (const m of sanitized.matchAll(REGISTER_BP_RE)) {
    blueprintPrefix.set(m[1], m[2]);
  }
  const BLUEPRINT_DEF_RE =
    /([A-Za-z_][\w]*)\s*=\s*Blueprint\s*\(\s*['\"][^'\"\s]+['\"]\s*,[\s\S]*?url_prefix\s*=\s*['\"]([^'\"]+)['\"]/g;
  for (const m of sanitized.matchAll(BLUEPRINT_DEF_RE)) {
    blueprintPrefix.set(m[1], m[2]);
  }
  const METHOD_VIEW_CLASS_RE =
    /class\s+([A-Za-z_][\w]*)\s*\(\s*MethodView\s*\)[\s\S]*?(?=\nclass\s|\n\n|$)/g;
  for (const m of sanitized.matchAll(METHOD_VIEW_CLASS_RE)) {
    const className = m[1];
    const body = m[0];
    const methods = Array.from(body.matchAll(/def\s+(get|post|put|delete|patch)\s*\(/g)).map((x) =>
      x[1].toUpperCase(),
    );
    if (methods.length) methodViewMethods.set(className, methods);
  }
  const ROUTE_RE =
    /@([A-Za-z_][\w.]*)\.(route|get|post|put|delete|patch|options|head|add_url_rule)\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of content.matchAll(ROUTE_RE)) {
    const decoratorTarget = m[1];
    const methodName = m[2];
    let routePath = m[3];
    const args = m[4] || "";
    const methods =
      methodName === "route" || methodName === "add_url_rule"
        ? (() => {
            const result = parseMethodList(args);
            return result.length ? result : ["GET"];
          })()
        : [methodName.toUpperCase()];
    const viewClassName = args.match(/([A-Za-z_][\w]*)\.as_view\(/)?.[1];
    if (methodName === "add_url_rule" && viewClassName && methodViewMethods.has(viewClassName)) {
      const viewMethods = methodViewMethods.get(viewClassName);
      if (viewMethods?.length) {
        methods.length = 0;
        methods.push(...viewMethods);
      }
    }
    const prefix = blueprintPrefix.get(decoratorTarget.split(".")[0]);
    if (prefix)
      routePath = normalizePath(`${prefix}${routePath.startsWith("/") ? "" : "/"}${routePath}`);
    const head = content.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0);
    const hasAuthDec =
      /@login_required|@jwt_required|@token_required|@requires_auth|@permission_required/.test(
        head,
      );
    for (const method of methods) {
      const r = makeRoute(method, routePath, "");
      if (hasAuthDec || /@login_required|@jwt_required|@token_required|@requires_auth/.test(m[0])) {
        r.authRequired = true;
        r.authType = "middleware";
        r.reasonings?.push("Décorateur d'auth Flask détecté");
      }
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  const ADD_URL_RULE_RE =
    /([A-Za-z_][\w.]*)\.add_url_rule\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of content.matchAll(ADD_URL_RULE_RE)) {
    const decoratorTarget = m[1];
    let routePath = m[2];
    const args = m[3] || "";
    const methods: string[] = (() => {
      const result = parseMethodList(args);
      return result.length ? result : ["GET"];
    })();
    const viewClassName = args.match(/([A-Za-z_][\w]*)\.as_view\(/)?.[1];
    if (viewClassName && methodViewMethods.has(viewClassName)) {
      const viewMethods = methodViewMethods.get(viewClassName);
      if (viewMethods?.length) {
        methods.length = 0;
        methods.push(...viewMethods);
      }
    }
    const prefix = blueprintPrefix.get(decoratorTarget.split(".")[0]);
    if (prefix)
      routePath = normalizePath(`${prefix}${routePath.startsWith("/") ? "" : "/"}${routePath}`);
    for (const method of methods) {
      const r = makeRoute(method, routePath, "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  const ADD_RESOURCE_RE =
    /([A-Za-z_][\w.]*)\.add_resource\s*\(\s*([A-Za-z_][\w.]*)\s*,\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of content.matchAll(ADD_RESOURCE_RE)) {
    const resourceClass = m[2];
    const routePath = m[3];
    const methods = methodViewMethods.get(resourceClass) ?? [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
    ];
    for (const method of methods) {
      const r = makeRoute(method, routePath, "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  if (routes.length === 0) {
    const SIMPLE = /@app\.route\s*\(\s*['"]([^'"]+)['"]/g;
    for (const m of content.matchAll(SIMPLE)) {
      routes.push(makeRoute("GET", m[1], ""));
    }
  }
  return routes;
}

// ── Django ──────────────────────────────────────────────────────────────────

export function detectDjango(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "django");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const PATH_RE = /(?:re_)?path\s*\(\s*['"]([^'"]+)['"],\s*([A-Za-z_][\w.]*)/g;
  for (const m of content.matchAll(PATH_RE)) {
    const r = makeRoute("GET", m[1].replace(/\(\?P<[^>]+>[^)]+\)/g, ":param"), "");
    r.controller = m[2];
    const viewDef = content.match(
      new RegExp(`${escapeRegExpStr(m[2])}[\\s\\S]{0,200}?@(?:login_required|permission_required)`),
    );
    if (viewDef) {
      r.authRequired = true;
      r.authType = "middleware";
      r.reasonings?.push("Django @login_required / @permission_required");
    }
    routes.push(r);
  }
  const ROUTER_RE = /router\.register\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_][\w]*)/g;
  for (const m of content.matchAll(ROUTER_RE)) {
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      routes.push(makeRoute(method, `/${m[1]}`, ""));
    }
  }
  return routes;
}

// ── Tornado ─────────────────────────────────────────────────────────────────

export function detectTornado(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "tornado");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const handlerMethods = new Map<string, string[]>();
  const HANDLER_RE =
    /class\s+([A-Za-z_][\w]*)\s*\([^\n]*RequestHandler[^\)]*\):([\s\S]*?)(?=\nclass\s|\n\n|$)/g;
  for (const m of sanitized.matchAll(HANDLER_RE)) {
    const className = m[1];
    const body = m[2];
    const methods = Array.from(body.matchAll(/def\s+(get|post|put|delete|patch)\s*\(/g)).map((x) =>
      x[1].toUpperCase(),
    );
    if (methods.length) handlerMethods.set(className, methods);
  }
  const ROUTE_LIST_RE = /Application\s*\(\s*\[([\s\S]*?)\]/g;
  for (const m of sanitized.matchAll(ROUTE_LIST_RE)) {
    const listBody = m[1];
    for (const entry of listBody.matchAll(/\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_][\w.]*)/g)) {
      const pathValue = entry[1];
      const handler = entry[2].split(".").pop() || entry[2];
      const methods = handlerMethods.get(handler) ?? ["GET"];
      for (const method of methods) {
        const r = makeRoute(method, normalizePath(pathValue), "");
        detectAuthByStatusSignal(content, r);
        routes.push(r);
      }
    }
  }
  return routes;
}

// ── Sanic ───────────────────────────────────────────────────────────────────

export function detectSanic(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "sanic");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const blueprintPrefix = new Map<string, string>();
  const BLUEPRINT_DEF_RE =
    /([A-Za-z_][\w]*)\s*=\s*Blueprint\s*\(\s*['"][^'\"\s]+['\"]\s*,[\s\S]*?url_prefix\s*=\s*['"]([^'\"]+)['"]/g;
  for (const m of sanitized.matchAll(BLUEPRINT_DEF_RE)) {
    blueprintPrefix.set(m[1], m[2]);
  }
  const ROUTE_RE =
    /@([A-Za-z_][\w.]*)\.(get|post|put|delete|patch|options|head|route)\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of sanitized.matchAll(ROUTE_RE)) {
    const target = m[1];
    const methodName = m[2];
    let routePath = m[3];
    const args = m[4] || "";
    const methods =
      methodName === "route"
        ? (() => {
            const result = parseMethodList(args);
            return result.length ? result : ["GET"];
          })()
        : [methodName.toUpperCase()];
    const prefix = blueprintPrefix.get(target.split(".")[0]);
    if (prefix)
      routePath = normalizePath(`${prefix}${routePath.startsWith("/") ? "" : "/"}${routePath}`);
    for (const method of methods) {
      const r = makeRoute(method, normalizePath(routePath), "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  const ADD_ROUTE_RE =
    /([A-Za-z_][\w.]*)\.add_route\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of sanitized.matchAll(ADD_ROUTE_RE)) {
    let method = m[2].toUpperCase();
    const routePath = m[3];
    const args = m[4] || "";
    if (method === "ROUTE") {
      const explicit = args.match(/['\"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['\"]/i)?.[1];
      if (explicit) method = explicit.toUpperCase();
    }
    const r = makeRoute(method, normalizePath(routePath), "");
    detectAuthByStatusSignal(content, r);
    routes.push(r);
  }
  return routes;
}

// ── Starlette ───────────────────────────────────────────────────────────────

export function detectStarlette(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "starlette");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const ROUTE_RE = /Route\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of sanitized.matchAll(ROUTE_RE)) {
    const routePath = m[1];
    const args = m[2] || "";
    const methods = (() => {
      const result = parseMethodList(args);
      return result.length ? result : ["GET"];
    })();
    for (const method of methods) {
      const r = makeRoute(method, normalizePath(routePath), "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  return routes;
}

// ── Litestar ────────────────────────────────────────────────────────────────

export function detectLitestar(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "litestar");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const ROUTE_RE =
    /@(?:get|post|put|delete|patch|options|head|route)\s*\(\s*['\"]([^'"]+)['\"]([\s\S]*?)\)/g;
  for (const m of sanitized.matchAll(ROUTE_RE)) {
    const routePath = m[1];
    const argText = m[2] || "";
    const methods = (() => {
      const result = parseMethodList(argText);
      return result.length ? result : ["GET"];
    })();
    for (const method of methods) {
      const r = makeRoute(method, normalizePath(routePath), "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  return routes;
}

// ── Aiohttp ─────────────────────────────────────────────────────────────────

export function detectAiohttp(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "aiohttp");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const DECORATOR_RE =
    /@([A-Za-z_][\w.]*)\.(get|post|put|delete|patch)\s*\(\s*['\"]([^'"]+)['\"]([\s\S]*?)\)/g;
  for (const m of sanitized.matchAll(DECORATOR_RE)) {
    const method = m[2].toUpperCase();
    const routePath = m[3];
    const r = makeRoute(method, normalizePath(routePath), "");
    detectAuthByStatusSignal(content, r);
    routes.push(r);
  }
  const ADD_ROUTE_RE =
    /([A-Za-z_][\w.]*)\.router\.add_(get|post|put|delete|patch|route)\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]([\s\S]*?)\)/g;
  for (const m of sanitized.matchAll(ADD_ROUTE_RE)) {
    let method = m[2].toUpperCase();
    const routePath = m[3];
    const args = m[4] || "";
    if (method === "ROUTE") {
      const explicit = args.match(/['\"](GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)['\"]/i)?.[1];
      if (explicit) method = explicit.toUpperCase();
    }
    const r = makeRoute(method, normalizePath(routePath), "");
    detectAuthByStatusSignal(content, r);
    routes.push(r);
  }
  return routes;
}

// ── Falcon ──────────────────────────────────────────────────────────────────

export function detectFalcon(content: string): DetectedRoute[] {
  const astRoutes = detectPythonRoutesAST(content, "falcon");
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const resourceMethods = new Map<string, string[]>();
  const RESOURCE_RE = /class\s+([A-Za-z_][\w]*)\s*\([^\n]*\):([\s\S]*?)(?=\nclass\s|\n\n|$)/g;
  for (const m of sanitized.matchAll(RESOURCE_RE)) {
    const className = m[1];
    const body = m[2];
    const methods = Array.from(body.matchAll(/def\s+on_(get|post|put|delete|patch)\s*\(/g)).map(
      (x) => x[1].toUpperCase(),
    );
    if (methods.length) resourceMethods.set(className, methods);
  }
  const ADD_ROUTE_RE =
    /([A-Za-z_][\w.]*)\.add_route\s*\(\s*['\"]([^'"\s][^'\"]*)['\"]\s*,\s*([A-Za-z_][\w.]*)/g;
  for (const m of sanitized.matchAll(ADD_ROUTE_RE)) {
    const routePath = m[2];
    const resourceName = m[3].split(".").pop() || m[3];
    const methods = resourceMethods.get(resourceName) ?? ["GET"];
    for (const method of methods) {
      const r = makeRoute(method, normalizePath(routePath), "");
      detectAuthByStatusSignal(content, r);
      routes.push(r);
    }
  }
  return routes;
}

// ── Python AST subprocess-based route detector ───────────────────────────────

function escapeRegExpStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectPythonRoutesAST(content: string, targetFramework?: string): DetectedRoute[] {
  try {
    if (typeof window !== "undefined") return [];
    const cpRequire = Function('return require("child_process")')();
    const spawnSync = cpRequire.spawnSync as (typeof import("child_process"))["spawnSync"];
    const py = spawnSync(
      "python",
      [
        "-c",
        `
import ast, sys, json, re

src = sys.stdin.read()
try:
    tree = ast.parse(src)
except SyntaxError:
    print(json.dumps([]))
    sys.exit(0)

routes = []

def get_str(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Str):
        return node.s
    return None

def get_method_name(deco):
    if isinstance(deco, ast.Call) and hasattr(deco.func, 'attr'):
        return deco.func.attr
    if isinstance(deco, ast.Call) and hasattr(deco.func, 'id'):
        return deco.func.id
    return None

def extract_method_list(call_node):
    for kw in getattr(call_node, 'keywords', []):
        if kw.arg == 'methods' and isinstance(kw.value, (ast.List, ast.Tuple)):
            return [get_str(elt) for elt in kw.value.elts if get_str(elt)]
    return []

def extract_decorator_path(deco):
    if isinstance(deco, ast.Call) and deco.args:
        return get_str(deco.args[0])
    return None

def detect_flask(routes, tree):
    bps = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and hasattr(node.value.func, 'id') and node.value.func.id == 'Blueprint':
            up = ''
            for kw in node.value.keywords:
                if kw.arg == 'url_prefix': up = get_str(kw.value) or ''
            if node.targets and hasattr(node.targets[0], 'id'): bps[node.targets[0].id] = up
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                mn = get_method_name(deco)
                if mn in ('route','get','post','put','delete','patch','options','head'):
                    path = extract_decorator_path(deco)
                    if path:
                        methods = extract_method_list(deco) if mn == 'route' else [mn.upper()]
                        if not methods: methods = ['GET']
                        ctrl = None; pref = None
                        if isinstance(deco, ast.Call) and hasattr(deco.func, 'value') and hasattr(deco.func.value, 'id'):
                            ctrl = deco.func.value.id
                            pref = bps.get(ctrl)
                        for m in methods:
                            fp = pref.rstrip('/') + '/' + path.lstrip('/') if pref else path
                            routes.append({"method": m, "path": fp, "name": node.name, "framework": "flask", "controller": ctrl})
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if hasattr(call.func, 'attr') and call.func.attr == 'add_url_rule' and call.args:
                path = get_str(call.args[0])
                if path:
                    for m in extract_method_list(call) or ['GET']:
                        routes.append({"method": m, "path": path, "name": "", "framework": "flask"})

def detect_fastapi(routes, tree):
    rtrs = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and hasattr(node.value.func, 'id') and node.value.func.id == 'APIRouter':
            p = ''
            for kw in node.value.keywords:
                if kw.arg == 'prefix': p = get_str(kw.value) or ''
            if node.targets and hasattr(node.targets[0], 'id'): rtrs[node.targets[0].id] = p
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                mn = get_method_name(deco)
                if mn in ('get','post','put','delete','patch','options','head'):
                    path = extract_decorator_path(deco)
                    if path:
                        ctrl = None; p = ''
                        if isinstance(deco, ast.Call) and hasattr(deco.func, 'value') and hasattr(deco.func.value, 'id'):
                            ctrl = deco.func.value.id
                            p = rtrs.get(ctrl, '')
                        fp = p + '/' + path.lstrip('/') if p else path
                        ri = {"method": mn.upper(), "path": fp, "name": node.name, "framework": "fastapi", "controller": ctrl}
                        if deco.keywords:
                            for kw in deco.keywords:
                                if kw.arg == 'dependencies' and isinstance(kw.value, ast.List): ri['auth'] = True
                        routes.append(ri)
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if hasattr(call.func, 'attr') and call.func.attr == 'include_router' and call.args and hasattr(call.args[0], 'id'):
                ip = ''
                for kw in call.keywords:
                    if kw.arg == 'prefix': ip = get_str(kw.value) or ''
                if call.args[0].id in rtrs and ip:
                    rtrs[call.args[0].id] = ip + '/' + rtrs[call.args[0].id].lstrip('/')

def detect_django(routes, tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and node.targets and hasattr(node.targets[0], 'id') and node.targets[0].id == 'urlpatterns' and isinstance(node.value, ast.List):
            for elt in node.value.elts:
                if isinstance(elt, ast.Call) and hasattr(elt.func, 'id') and elt.func.id in ('path','re_path') and elt.args:
                    path = get_str(elt.args[0])
                    vn = ''
                    if len(elt.args) > 1:
                        v = elt.args[1]
                        vn = v.id if hasattr(v, 'id') else (v.attr if hasattr(v, 'attr') else '')
                    if path:
                        routes.append({"method": "GET", "path": path, "name": vn, "framework": "django"})
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if hasattr(call.func, 'attr') and call.func.attr == 'register' and call.args:
                path = get_str(call.args[0])
                if path:
                    for m in ('GET','POST','PUT','DELETE','PATCH'):
                        routes.append({"method": m, "path": '/' + path.lstrip('/'), "name": "", "framework": "django"})

def detect_tornado(routes, tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                if isinstance(deco, ast.Call) and hasattr(deco.func, 'id') and deco.func.id == 'route':
                    path = extract_decorator_path(deco)
                    if path:
                        routes.append({"method": "GET", "path": path, "name": node.name, "framework": "tornado"})
    for node in ast.walk(tree):
        is_app_call = False
        if isinstance(node, ast.Call):
            if hasattr(node.func, 'id') and node.func.id == 'Application':
                is_app_call = True
            elif hasattr(node.func, 'attr') and node.func.attr == 'Application':
                is_app_call = True
        if is_app_call and node.args and isinstance(node.args[0], ast.List):
            for elt in node.args[0].elts:
                if isinstance(elt, ast.Tuple) and len(elt.elts) >= 2:
                    path = get_str(elt.elts[0])
                    if path:
                        routes.append({"method": "GET", "path": path, "name": "", "framework": "tornado"})

def detect_sanic(routes, tree):
    bps = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and hasattr(node.value.func, 'id') and node.value.func.id == 'Blueprint':
            up = ''
            for kw in node.value.keywords:
                if kw.arg == 'url_prefix': up = get_str(kw.value) or ''
            if node.targets and hasattr(node.targets[0], 'id'): bps[node.targets[0].id] = up
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                mn = get_method_name(deco)
                if mn in ('get','post','put','delete','patch','options','head','route'):
                    path = extract_decorator_path(deco)
                    if path:
                        methods = extract_method_list(deco) if mn == 'route' else [mn.upper()]
                        if not methods: methods = ['GET']
                        ctrl, tp = None, None
                        if isinstance(deco, ast.Call) and hasattr(deco.func, 'value') and hasattr(deco.func.value, 'id'):
                            ctrl = deco.func.value.id
                            tp = bps.get(ctrl)
                        for m in methods:
                            fp = tp.rstrip('/') + '/' + path.lstrip('/') if tp else path
                            routes.append({"method": m, "path": fp, "name": node.name, "framework": "sanic", "controller": ctrl})
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if hasattr(call.func, 'attr') and call.func.attr == 'add_route' and len(call.args) >= 2:
                path = get_str(call.args[1])
                if path:
                    routes.append({"method": "GET", "path": path, "name": "", "framework": "sanic"})

def detect_starlette(routes, tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and hasattr(node.func, 'id') and node.func.id == 'Route':
            path = None; endpoint = ''; methods = ['GET']
            if node.args: path = get_str(node.args[0])
            for kw in getattr(node, 'keywords', []):
                if kw.arg == 'path': path = get_str(kw.value)
                elif kw.arg == 'endpoint' and hasattr(kw.value, 'id'): endpoint = kw.value.id
                elif kw.arg == 'methods':
                    em = extract_method_list(type('obj', (object,), {'keywords': [type('obj', (object,), {'arg': 'methods', 'value': kw.value})()]})())
                    if em: methods = em
            if path:
                for m in methods:
                    routes.append({"method": m, "path": path, "name": endpoint, "framework": "starlette"})

def detect_litestar(routes, tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                mn = get_method_name(deco)
                if mn in ('get','post','put','delete','patch','options','head','route'):
                    path = extract_decorator_path(deco)
                    if path:
                        methods = extract_method_list(deco) if mn == 'route' else [mn.upper()]
                        if not methods: methods = ['GET']
                        for m in methods:
                            routes.append({"method": m, "path": path, "name": node.name, "framework": "litestar"})

def detect_aiohttp(routes, tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                mn = get_method_name(deco)
                if mn in ('get','post','put','delete','patch','options','head'):
                    path = extract_decorator_path(deco)
                    if path:
                        routes.append({"method": mn.upper(), "path": path, "name": node.name, "framework": "aiohttp"})
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if hasattr(call.func, 'attr'):
                attr = call.func.attr
                mm = {'add_get':'GET','add_post':'POST','add_put':'PUT','add_delete':'DELETE','add_patch':'PATCH','add_route':'GET'}
                if attr in mm and call.args:
                    path = get_str(call.args[0])
                    if path:
                        routes.append({"method": mm[attr], "path": path, "name": "", "framework": "aiohttp"})

def detect_falcon(routes, tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if hasattr(call.func, 'attr') and call.func.attr == 'add_route' and len(call.args) >= 1:
                path = get_str(call.args[0])
                if path:
                    rn = call.args[1].id if len(call.args) >= 2 and hasattr(call.args[1], 'id') else ''
                    routes.append({"method": "GET", "path": path, "name": rn, "framework": "falcon"})

flags = {
    'flask': bool(re.search(r'from\\s+flask\\s+import|import\\s+flask|Flask\\s*\\(', src)),
    'fastapi': bool(re.search(r'from\\s+fastapi\\s+import|import\\s+fastapi|FastAPI\\s*\\(', src)),
    'django': bool(re.search(r'from\\s+django\\s+import|import\\s+django|django\\.urls|urlpatterns\\s*=', src)),
    'tornado': bool(re.search(r'from\\s+tornado\\s+import|import\\s+tornado|tornado\\.web|RequestHandler', src)),
    'sanic': bool(re.search(r'from\\s+sanic\\s+import|import\\s+sanic|Sanic\\s*\\(', src)),
    'starlette': bool(re.search(r'from\\s+starlette\\s+import|import\\s+starlette|starlette\\.routing', src)),
    'litestar': bool(re.search(r'from\\s+litestar\\s+import|import\\s+litestar|Litestar\\s*\\(', src)),
    'aiohttp': bool(re.search(r'from\\s+aiohttp\\s+import|import\\s+aiohttp|aiohttp\\.web', src)),
    'falcon': bool(re.search(r'from\\s+falcon\\s+import|import\\s+falcon|falcon\\.(API|App|api)', src)),
}

if flags['flask']: detect_flask(routes, tree)
if flags['fastapi']: detect_fastapi(routes, tree)
if flags['django']: detect_django(routes, tree)
if flags['tornado']: detect_tornado(routes, tree)
if flags['sanic']: detect_sanic(routes, tree)
if flags['starlette']: detect_starlette(routes, tree)
if flags['litestar']: detect_litestar(routes, tree)
if flags['aiohttp']: detect_aiohttp(routes, tree)
if flags['falcon']: detect_falcon(routes, tree)

if not any(flags.values()):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                mn = get_method_name(deco)
                if mn in ('get','post','put','delete','patch','options','head','route'):
                    path = extract_decorator_path(deco)
                    if path:
                        routes.append({"method": mn.upper() if mn != 'route' else 'GET', "path": path, "name": node.name, "framework": "unknown_python"})

print(json.dumps(routes))
`,
      ],
      { input: content, encoding: "utf8" },
    );
    if (py.status !== 0) {
      console.error("Python AST error:", py.stderr?.toString());
      return [];
    }
    if (py.stdout) {
      const parsed = JSON.parse(py.stdout.toString());
      if (!targetFramework) return parsed.map((r: any) => makeRoute(r.method, r.path, r.name));
      return parsed
        .filter((r: any) => r.framework === targetFramework)
        .map((r: any) => {
          const route = makeRoute(r.method, r.path, r.name || "");
          if (r.controller) route.controller = r.controller;
          if (r.auth) {
            route.authRequired = true;
            route.authType = "jwt";
            route.reasonings?.push("Auth detecte par AST Python");
          }
          return route;
        });
    }
  } catch {}
  return [];
}
