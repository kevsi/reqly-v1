/**
 * Python AST subprocess-based route detector.
 * Uses a spawned Python child process to parse Python AST for route detection
 * across all supported Python frameworks.
 */

import { makeRoute } from "@/lib/detect-shared-types";
import type { DetectedRoute } from "@/lib/detect-shared-types";

interface PythonAstRoute {
  method: string;
  path: string;
  name?: string;
  controller?: string;
  auth?: boolean;
  framework?: string;
}

export function detectPythonRoutesAST(content: string, targetFramework?: string): DetectedRoute[] {
  try {
    if (typeof window !== "undefined") return [];
    if (typeof process.getBuiltinModule !== "function") return [];
    const cp = process.getBuiltinModule("child_process") as typeof import("child_process");
    if (!cp) return [];
    const spawnSync = cp.spawnSync;
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
      const parsed = JSON.parse(py.stdout.toString()) as PythonAstRoute[];
      if (!targetFramework) return parsed.map((r) => makeRoute(r.method, r.path, r.name ?? ""));
      return parsed
        .filter((r) => r.framework === targetFramework)
        .map((r) => {
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
  } catch {
    // AST detection is optional; callers fall back to regex-based detection.
  }
  return [];
}
