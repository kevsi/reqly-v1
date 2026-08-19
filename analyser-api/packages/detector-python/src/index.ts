import * as path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  AUTH_HINTS,
  extractParams,
  isHttpMethod,
  joinPaths,
  makeId,
  stripQuotes,
} from "@analyser/core";
import type { ApiRoute, AstGrepMatch, AstGrepRule, Detector, HttpMethod } from "@analyser/core";

const FASTAPI_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

const PRIMITIVES = new Set([
  "str",
  "int",
  "float",
  "bool",
  "bytes",
  "dict",
  "list",
  "tuple",
  "set",
  "None",
  "Any",
  "Optional",
  "Union",
  "Request",
  "Response",
  "BackgroundTasks",
  "Depends",
  "Query",
  "Path",
  "Body",
  "Header",
  "Cookie",
  "Form",
  "File",
]);

const RULES: AstGrepRule[] = [
  { id: "binding", pattern: "$NAME = $INIT" },
  { id: "decorator", pattern: "@$APP.$METHOD($$$ARGS)" },
  { id: "flask-route", pattern: "@$APP.route($$$ARGS)" },
  { id: "django-path", pattern: "$FUNC($$$ARGS)" },
  { id: "py-import", pattern: "import $MOD" },
  { id: "py-import-from", pattern: "from $MOD import $NAME" },
  { id: "include-router", pattern: "$APP.include_router($ROUTER, prefix=$PREFIX)" },
  {
    id: "include-router-prefixed",
    pattern: "$APP.include_router($ROUTER, prefix=$PREFIX, $$$REST)",
  },
  { id: "include-router-bare", pattern: "$APP.include_router($ROUTER)" },
];

function methodFromKwargs(text: string): HttpMethod {
  const m = text.match(/methods\s*=\s*\[([^\]]*)\]/);
  if (!m) return "GET";
  const list = (m[1] ?? "").match(/["'](\w+)["']/g) ?? [];
  if (list.length === 0) return "GET";
  if (list.length > 1) return "ALL";
  const single = list[0]!.replace(/["']/g, "").toUpperCase();
  return isHttpMethod(single) ? (single as HttpMethod) : "GET";
}

function functionTextOf(decoratorNode: AstGrepMatch["node"]): string {
  let cur = decoratorNode.parent();
  while (cur && cur.kind() !== "decorated_definition" && cur.kind() !== "function_definition") {
    cur = cur.parent();
  }
  return cur?.text() ?? "";
}

function nonCommaArgs(m: AstGrepMatch): string[] {
  return m.node.getAll("ARGS").filter((a) => a !== ",");
}

export const detectorPython: Detector = {
  name: "detector-python",
  language: "python",
  frameworks: ["fastapi", "flask", "django"],
  extensions: [".py"],
  ignoreDirs: ["venv", ".venv", "__pycache__"],
  canHandle(manifestFiles) {
    return manifestFiles.some((f) =>
      ["requirements.txt", "pyproject.toml", "Pipfile"].includes(path.basename(f)),
    );
  },
  rules: RULES,
  assemble(matches: AstGrepMatch[], rootPath?: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    void rootPath;

    const files = new Set(matches.map((m) => m.file));
    if (rootPath) {
      const stack = [rootPath];
      while (stack.length) {
        const dir = stack.pop()!;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (!["node_modules", ".git", "venv", ".venv", "__pycache__"].includes(e.name))
              stack.push(full);
          } else if (e.name.endsWith(".py")) {
            files.add(full);
          }
        }
      }
    }

    /** Package-relative module of a file, walking up while __init__.py exists. */
    const moduleOf = (file: string): string => {
      let dir = path.dirname(file);
      const dirs: string[] = [];
      while (existsSync(path.join(dir, "__init__.py"))) {
        dirs.unshift(path.basename(dir));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return [...dirs, path.basename(file, path.extname(file))].join(".");
    };

    const bindings = new Map<string, Map<string, string>>();
    const selfPrefix = new Map<string, string>();
    for (const m of matches) {
      if (m.ruleId !== "binding") continue;
      const name = m.node.get("NAME");
      const init = m.node.get("INIT") ?? "";
      if (!name || !/^(Flask|FastAPI|APIRouter)/.test(init)) continue;
      let map = bindings.get(m.file);
      if (!map) {
        map = new Map();
        bindings.set(m.file, map);
      }
      if (!map.has(name)) map.set(name, init);
      if (init.startsWith("APIRouter")) {
        const own = init.match(/prefix\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
        if (own) selfPrefix.set(`${moduleOf(m.file)}::${name}`, own);
      }
    }

    const frameworkOf = (file: string, name: string): string => {
      const init = bindings.get(file)?.get(name);
      if (init?.startsWith("Flask")) return "flask";
      return "fastapi";
    };

    /** Finds the module (as a package path) of a file whose computed module is
     * `mod` or ends with `.mod` (imports use PYTHONPATH, not repo root). */
    const resolveModule = (mod: string): string | null => {
      const all = [...files];
      const hit = all.find((f) => moduleOf(f) === mod);
      if (hit) return mod;
      const suffix = all.find((f) => moduleOf(f).endsWith("." + mod));
      return suffix ? moduleOf(suffix) : null;
    };

    const imports = new Map<string, Map<string, string>>();
    for (const m of matches) {
      let mod: string;
      let names: string[];
      if (m.ruleId === "py-import") {
        mod = m.node.get("MOD") ?? "";
        names = [mod.split(".")[0] ?? ""];
      } else if (m.ruleId === "py-import-from") {
        mod = m.node.get("MOD") ?? "";
        const after = m.text.replace(/^from\s+[\w.]+\s+import\s+/, "");
        names = after
          .split(",")
          .map((s) => s.trim().split(/\s+as\s+/)[0] ?? "")
          .filter(Boolean);
      } else continue;
      let map = imports.get(m.file);
      if (!map) {
        map = new Map();
        imports.set(m.file, map);
      }
      for (const n of names) if (n) map.set(n, mod);
    }

    const constants = new Map<string, Map<string, string>>();
    for (const file of files) {
      const map = new Map<string, string>();
      for (const mm of readFileSync(file, "utf8").matchAll(
        /(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(['"])(.*?)\2/gm,
      )) {
        if (mm[1] && mm[3]) map.set(mm[1], mm[3]);
      }
      if (map.size) constants.set(moduleOf(file), map);
    }

    const resolveConstant = (file: string, ref: string): string => {
      const chain = ref.split(".");
      const last = chain[chain.length - 1] ?? "";
      if (chain.length > 1) {
        const base = imports.get(file)?.get(chain[0] ?? "");
        if (base) {
          const mod = resolveModule(base);
          const v = mod && constants.get(mod)?.get(last);
          if (v) return v;
        }
      } else {
        const v = constants.get(moduleOf(file))?.get(last);
        if (v) return v;
      }
      for (const c of constants.values()) {
        const v = c.get(last);
        if (v) return v;
      }
      return "";
    };

    /** Resolves a router reference (imported or local) to (module, routerName). */
    const resolveRouter = (file: string, ref: string): { module: string; name: string } | null => {
      const parts = ref.split(".");
      const alias = parts[0] ?? "";
      const base = imports.get(file)?.get(alias);
      const local = bindings.get(file)?.get(alias);
      if (base) {
        const sub = resolveModule(base + "." + alias);
        if (sub) {
          return parts.length >= 2
            ? { module: sub, name: parts[1] ?? "" }
            : { module: sub, name: alias };
        }
        const mod = resolveModule(base);
        if (mod) {
          return parts.length >= 2
            ? { module: mod, name: parts[1] ?? "" }
            : { module: mod, name: alias };
        }
        return null;
      }
      if (local?.startsWith("APIRouter")) {
        return parts.length >= 2
          ? { module: moduleOf(file), name: parts[1] ?? "" }
          : { module: moduleOf(file), name: alias };
      }
      return null;
    };

    // mount graph: parentKey ("ROOT" or "module::name") -> children
    const adj = new Map<string, { child: string; prefix: string }[]>();
    for (const m of matches) {
      if (!m.ruleId.startsWith("include-router")) continue;
      const child = resolveRouter(m.file, m.node.get("ROUTER") ?? "");
      if (!child) continue;
      const parent = resolveRouter(m.file, m.node.get("APP") ?? "");
      const parentKey = parent ? `${parent.module}::${parent.name}` : "ROOT";
      const raw = (m.node.get("PREFIX") ?? "").trim();
      const prefix = raw
        ? raw.startsWith('"') || raw.startsWith("'")
          ? stripQuotes(raw)
          : resolveConstant(m.file, raw)
        : "";
      const list = adj.get(parentKey) ?? [];
      list.push({ child: `${child.module}::${child.name}`, prefix });
      adj.set(parentKey, list);
    }

    // BFS from ROOT computes each router's cumulative mount prefix.
    const cumulative = new Map<string, string>();
    const queue: { key: string; prefix: string }[] = [{ key: "ROOT", prefix: "" }];
    while (queue.length) {
      const { key, prefix } = queue.shift()!;
      for (const e of adj.get(key) ?? []) {
        const p = joinPaths(joinPaths(prefix, e.prefix), selfPrefix.get(e.child) ?? "");
        cumulative.set(e.child, p);
        queue.push({ key: e.child, prefix: p });
      }
    }

    const addFrameworkRoute = (
      m: AstGrepMatch,
      app: string,
      methodRaw: HttpMethod,
      p: string,
      fnText: string,
    ) => {
      const depNames =
        [...fnText.matchAll(/Depends\((\w+)\)/g)]
          .map((x) => x[1]!)
          .filter((n) => AUTH_HINTS.test(n)) ?? [];
      const pathParams = [...fnText.matchAll(/(\w+):\s*[^=]+=\s*Path\(/g)].map((x) => x[1]!) ?? [];
      const queryParams =
        [...fnText.matchAll(/(\w+):\s*[^=]*=\s*Query\(/g)].map((x) => x[1]!) ?? [];
      const bodyModels = fnText.match(/def\s+\w+\(([^)]*)\)/)?.[1]?.split(",") ?? [];
      const bodySchema = bodyModels
        .map((p) => p.trim())
        .filter((p) => /^\w+:\s*\w+/.test(p))
        .map((p) => p.match(/^\w+:\s*(\w+)/)?.[1]!)
        .find((t) => t && !PRIMITIVES.has(t) && !AUTH_HINTS.test(t));

      routes.push({
        id: makeId("py", methodRaw, p, m.file, m.line),
        method: methodRaw,
        path: p,
        file: m.file,
        line: m.line,
        framework: frameworkOf(m.file, app),
        language: "python",
        auth: {
          required: depNames.length > 0,
          middleware: depNames.length ? depNames : undefined,
          confidence: depNames.length ? "high" : "low",
        },
        body: bodySchema ? { contentType: "application/json", schemaName: bodySchema } : undefined,
        params: [...new Set([...extractParams(p), ...pathParams])],
        query: queryParams.length ? queryParams : undefined,
        raw: fnText.slice(0, 500),
      });
    };

    for (const m of matches) {
      if (m.ruleId === "flask-route") {
        const app = m.node.get("APP") ?? "";
        const p = stripQuotes(nonCommaArgs(m)[0] ?? "");
        if (!p) continue;
        const method = methodFromKwargs(m.text);
        const fnText = functionTextOf(m.node);
        const authNames =
          [...fnText.matchAll(/@([A-Za-z_]\w*)/g)]
            .map((x) => x[1]!)
            .filter((n) => AUTH_HINTS.test(n)) ?? [];
        const isJson = /request\.(get_json|json)/.test(fnText);
        const isForm = /request\.form/.test(fnText);
        routes.push({
          id: makeId("py", method, p, m.file, m.line),
          method,
          path: p,
          file: m.file,
          line: m.line,
          framework: "flask",
          language: "python",
          auth: {
            required: authNames.length > 0,
            middleware: authNames.length ? authNames : undefined,
            confidence: authNames.length ? "medium" : "low",
          },
          body: isJson
            ? { contentType: "application/json" }
            : isForm
              ? { contentType: "application/x-www-form-urlencoded" }
              : undefined,
          params: extractParams(p),
          raw: fnText.slice(0, 500),
        });
      } else if (m.ruleId === "decorator") {
        const app = m.node.get("APP") ?? "";
        const methodRaw = m.node.get("METHOD") ?? "";
        if (!FASTAPI_METHODS.has(methodRaw.toLowerCase())) continue;
        const p0 = stripQuotes(nonCommaArgs(m)[0] ?? "");
        if (!p0) continue;
        const node = resolveRouter(m.file, app);
        const pref = node ? cumulative.get(`${node.module}::${node.name}`) : undefined;
        const p = pref ? joinPaths(pref, p0) : p0;
        const fnText = functionTextOf(m.node);
        addFrameworkRoute(m, app, methodRaw.toUpperCase() as HttpMethod, p, fnText);
      } else if (m.ruleId === "django-path") {
        const func = m.node.get("FUNC") ?? "";
        if (!/^(path|re_path)$/.test(func)) continue;
        const args = nonCommaArgs(m);
        const p = stripQuotes((args[0] ?? "").replace(/^[rbfu]"/, '"')).replace(/^\^/, "");
        if (!p) continue;
        const djangoParams = [
          ...new Set([...p.matchAll(/<(?:[A-Za-z]+:)?(\w+)>/g)].map((x) => x[1]!)),
        ];
        routes.push({
          id: makeId("py", "ALL", p, m.file, m.line),
          method: "ALL",
          path: p,
          file: m.file,
          line: m.line,
          framework: "django",
          language: "python",
          auth: { required: false, confidence: "low" },
          params: djangoParams.length ? djangoParams : undefined,
          handlerName: args[1],
          raw: m.text.slice(0, 300),
        });
      }
    }

    return routes;
  },
};
