import * as path from "node:path";
import { readFileSync } from "node:fs";
import {
  AUTH_HINTS,
  extractParams,
  joinPaths,
  makeId,
  stripQuotes,
} from "@analyser/core";
import type {
  ApiRoute,
  AstGrepMatch,
  AstGrepRule,
  Detector,
  HttpMethod,
} from "@analyser/core";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "Any"]);

const RULES: AstGrepRule[] = [
  { id: "binding", pattern: "$NAME := $INIT" },
  { id: "route", pattern: "$ROUTER.$METHOD($PATH, $$$HANDLERS)" },
  { id: "group", pattern: "$NAME := $PARENT.Group($$$ARGS)" },
];

/** ast-grep's Go grammar cannot match method calls with a single argument
 * (e.g. `v1.Use(jwtAuth)`), so Use() middleware is extracted per file with a
 * regex pass instead of an ast-grep rule. */
const USE_CALL_RE = /\b([A-Za-z_]\w*)\.Use\s*\(([^)]*)\)/g;

interface RouterInfo {
  /** Receiver of the Group() call; empty for engines (gin.New/Default, echo.New). */
  parent: string;
  prefix: string;
  middleware: string[];
  engineFlavor: "" | "gin" | "echo";
}

/** Extracts identifier tokens from middleware arguments (`authRequired()`,
 * `middleware.Auth()` -> ["authRequired"] / ["middleware", "Auth"]). */
function middlewareIdents(args: string[]): string[] {
  return args
    .filter((a) => a !== ",")
    .flatMap((a) => a.match(/[A-Za-z_]\w*/g) ?? [])
    .filter(Boolean);
}

export const detectorGo: Detector = {
  name: "detector-go",
  language: "go",
  frameworks: ["gin", "echo"],
  extensions: [".go"],
  ignoreDirs: ["vendor"],
  canHandle(manifestFiles) {
    return manifestFiles.some((f) => path.basename(f) === "go.mod");
  },
  rules: RULES,
  assemble(matches: AstGrepMatch[], rootPath?: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    void rootPath;

    // Engines come from bindings, groups from the dedicated rule; Use() calls
    // attach middleware to an existing router by name.
    const routers = new Map<string, Map<string, RouterInfo>>();
    const useCalls = new Map<string, Map<string, string[]>>();

    const ensureMap = <T,>(store: Map<string, Map<string, T>>, file: string): Map<string, T> => {
      let map = store.get(file);
      if (!map) {
        map = new Map();
        store.set(file, map);
      }
      return map;
    };

    for (const m of matches) {
      if (m.ruleId === "binding") {
        const name = m.node.get("NAME");
        const init = m.node.get("INIT") ?? "";
        if (!name) continue;
        const engineFlavor = /gin\.(New|Default)\(\)/.test(init)
          ? "gin"
          : /echo\.New\(\)/.test(init)
            ? "echo"
            : "";
        if (!engineFlavor) continue;
        const map = ensureMap(routers, m.file);
        if (!map.has(name)) map.set(name, { parent: "", prefix: "", middleware: [], engineFlavor });
      } else if (m.ruleId === "group") {
        const name = m.node.get("NAME");
        if (!name) continue;
        const args = m.node.getAll("ARGS").filter((a) => a !== ",");
        const map = ensureMap(routers, m.file);
        if (!map.has(name)) {
          map.set(name, {
            parent: m.node.get("PARENT") ?? "",
            prefix: stripQuotes(args[0] ?? ""),
            middleware: middlewareIdents(args.slice(1)),
            engineFlavor: "",
          });
        }
      }
    }

    // Use() middleware is not matchable via ast-grep for single-argument
    // calls in Go, so we extract it with a regex pass over the matched files.
    const seenFiles = new Set(matches.map((m) => m.file));
    for (const file of seenFiles) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const um of src.matchAll(USE_CALL_RE)) {
        const router = um[1] ?? "";
        if (!router) continue;
        const ids = middlewareIdents((um[2] ?? "").split(","));
        const map = ensureMap(useCalls, file);
        map.set(router, [...(map.get(router) ?? []), ...ids]);
      }
    }

    /** Walks the group chain leaf -> root, accumulating prefix, middleware and
     * the engine flavor that classifies the framework. */
    const chainOf = (
      file: string,
      name: string,
    ): { prefix: string; middleware: string[]; engineFlavor: "" | "gin" | "echo" } => {
      let prefix = "";
      const middleware: string[] = [];
      let engineFlavor: RouterInfo["engineFlavor"] = "";
      let cur = name;
      for (let depth = 0; cur && depth < 16; depth++) {
        const info = routers.get(file)?.get(cur);
        if (!info) break;
        middleware.push(...info.middleware, ...(useCalls.get(file)?.get(cur) ?? []));
        engineFlavor = engineFlavor || info.engineFlavor;
        prefix = joinPaths(info.prefix, prefix);
        cur = info.parent;
      }
      return { prefix, middleware, engineFlavor };
    };

    for (const m of matches) {
      if (m.ruleId !== "route") continue;
      const methodRaw = m.node.get("METHOD") ?? "";
      if (!METHODS.has(methodRaw)) continue;
      const p0 = stripQuotes(m.node.get("PATH") ?? "");
      if (!p0) continue;
      const router = m.node.get("ROUTER") ?? "";
      const handlers = m.node.getAll("HANDLERS").filter((a) => a !== ",");
      const handler = handlers.join(", ");
      const { prefix, middleware, engineFlavor } = chainOf(m.file, router);
      const p = joinPaths(prefix, p0);
      // Middleware args between PATH and the final handler apply to this route.
      const routeMiddleware = middlewareIdents(handlers.slice(0, -1));
      const authMiddleware = [
        ...new Set([...middleware, ...routeMiddleware].filter((x) => AUTH_HINTS.test(x))),
      ];
      const bodyM =
        handler.match(/ShouldBindJSON\(&(\w+)\)/) ??
        handler.match(/Bind\(&(\w+)\)/) ??
        handler.match(/Decode\(&(\w+)\)/);
      const finalMethod = (methodRaw === "Any" ? "ALL" : methodRaw.toUpperCase()) as HttpMethod;
      routes.push({
        id: makeId("go", finalMethod, p, m.file, m.line),
        method: finalMethod,
        path: p,
        file: m.file,
        line: m.line,
        framework: engineFlavor === "echo" ? "echo" : "gin",
        language: "go",
        auth: {
          required: authMiddleware.length > 0,
          middleware: authMiddleware.length ? authMiddleware : undefined,
          confidence: authMiddleware.length ? "high" : "low",
        },
        body: bodyM?.[1] ? { contentType: "application/json", schemaName: bodyM[1] } : undefined,
        params: extractParams(p),
        handlerName: handlers[handlers.length - 1],
        raw: m.text.slice(0, 300),
      });
    }

    return routes;
  },
};
