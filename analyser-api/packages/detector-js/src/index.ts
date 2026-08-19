import * as path from "node:path";
import {
  AUTH_HINTS,
  extractParams,
  isHttpMethod,
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
  MatchedNode,
} from "@analyser/core";

const RULES: AstGrepRule[] = [
  { id: "js-binding", pattern: "const $NAME = $INIT" },
  { id: "js-binding-let", pattern: "let $NAME = $INIT" },
  { id: "js-binding-var", pattern: "var $NAME = $INIT" },
  {
    id: "route-call",
    pattern: "$APP.$METHOD($PATH, $$$ARGS)",
    kind: "call_expression",
  },
  { id: "route-object", pattern: "$APP.route($$$FIELDS)" },
  { id: "use-call", pattern: "$APP.use($PREFIX, $ROUTER)" },
  { id: "nestjs-method", pattern: "@$METHOD($PATH)" },
  { id: "nestjs-method-bare", pattern: "@$METHOD()" },
  { id: "nestjs-controller", pattern: "@Controller($PATH)" },
  { id: "nextjs-function", pattern: "function $NAME($$$PARAMS) { $$$BODY }" },
];

const EXPRESS_VARS = new Set(["app", "router", "server", "api", "r"]);

const NEST_METHODS = new Set(["Get", "Post", "Put", "Patch", "Delete", "All", "Options", "Head"]);

function authFromText(text: string): { required: boolean; middleware: string[] } {
  const middleware: string[] = [];
  for (const m of text.matchAll(/([A-Za-z_]\w*(?:\.\w+)*)/g)) {
    const tok = m[1] ?? "";
    if (AUTH_HINTS.test(tok) && tok.length > 1) middleware.push(tok);
  }
  return { required: middleware.length > 0, middleware: [...new Set(middleware)] };
}

function deriveNextJsPath(file: string, rootPath: string): string | undefined {
  const rel = path.relative(rootPath, file).replace(/\\/g, "/");
  const m = rel.match(/(?:app\/api|pages\/api)\/(.+)$/);
  if (!m) return undefined;
  let seg = m[1] ?? "";
  if (seg.endsWith("/route.ts")) seg = seg.slice(0, -"/route.ts".length);
  else seg = seg.replace(/\.(ts|tsx|js|jsx)$/, "");
  const parts = seg
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/^\[\.\.\.(.+)\]$/, ":$1").replace(/^\[(.+)\]$/, ":$1"));
  return "/api/" + parts.join("/");
}

function walkTo(node: MatchedNode, kind: string): MatchedNode | null {
  let cur = node.parent();
  while (cur && cur.kind() !== kind) cur = cur.parent();
  return cur;
}

/** TS decorators on methods are siblings inside class_body; the method is the
 * next method_definition after the decorator. Returns { node, decorators }. */
function enclosingMethod(
  decorator: MatchedNode,
): { node: MatchedNode; decorators: string[] } | null {
  const classBody = walkTo(decorator, "class_body");
  if (!classBody) return null;
  const kids = classBody.children();
  const idx = kids.findIndex((k) => k.line() === decorator.line());
  if (idx < 0) return null;
  const decorators = [kids[idx]!.text()];
  for (let i = idx + 1; i < kids.length; i++) {
    const k = kids[i]!;
    if (k.kind() === "method_definition") return { node: k, decorators };
    decorators.push(k.text());
  }
  return null;
}

function controllerPrefix(classBody: MatchedNode): string {
  let cur: MatchedNode | null = classBody;
  while (cur && !/@Controller\s*\(/.test(cur.text())) cur = cur.parent();
  if (!cur) return "";
  return cur.text().match(/@Controller\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ?? "";
}

export const detectorJs: Detector = {
  name: "detector-js",
  language: "javascript",
  frameworks: ["express", "fastify", "nestjs", "nextjs"],
  extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"],
  ignoreDirs: ["node_modules", ".next", "out", "public"],
  canHandle(manifestFiles) {
    return manifestFiles.some((f) => path.basename(f) === "package.json");
  },
  rules: RULES,
  assemble(matches: AstGrepMatch[], rootPath: string): ApiRoute[] {
    const routes: ApiRoute[] = [];

    const bindings = new Map<string, Map<string, string>>();
    for (const m of matches) {
      if (
        m.ruleId !== "js-binding" &&
        m.ruleId !== "js-binding-let" &&
        m.ruleId !== "js-binding-var"
      )
        continue;
      const name = m.node.get("NAME");
      const init = m.node.get("INIT") ?? "";
      if (!name || !/^(express|fastify)/.test(init)) continue;
      let map = bindings.get(m.file);
      if (!map) {
        map = new Map();
        bindings.set(m.file, map);
      }
      if (!map.has(name)) map.set(name, init);
    }

    const isKnownApp = (file: string, name: string): boolean => {
      const map = bindings.get(file);
      if (!map || map.size === 0) return EXPRESS_VARS.has(name);
      return map.has(name) || EXPRESS_VARS.has(name);
    };

    // router name -> mount prefix (from app.use("/api", router))
    const prefixes = new Map<string, Map<string, string>>();
    for (const m of matches) {
      if (m.ruleId !== "use-call") continue;
      const routerName = m.node.get("ROUTER") ?? "";
      const init = bindings.get(m.file)?.get(routerName) ?? "";
      if (!init.includes(".Router(")) continue;
      const prefix = stripQuotes(m.node.get("PREFIX") ?? "");
      if (!prefix) continue;
      let map = prefixes.get(m.file);
      if (!map) {
        map = new Map();
        prefixes.set(m.file, map);
      }
      map.set(routerName, prefix);
    }

    for (const m of matches) {
      if (m.ruleId === "route-call") {
        const methodRaw = m.node.get("METHOD")?.toUpperCase() ?? "";
        if (!isHttpMethod(methodRaw)) continue;
        const appName = m.node.get("APP") ?? "";
        if (!isKnownApp(m.file, appName)) continue;
        const p = joinPaths(
          prefixes.get(m.file)?.get(appName) ?? "",
          stripQuotes(m.node.get("PATH") ?? ""),
        );
        if (!p) continue;
        const args = m.node.getAll("ARGS");
        const handlerText = args[args.length - 1] ?? "";
        const auth = authFromText(args.join(" "));
        const body: ApiRoute["body"] = /\bbody\b/.test(handlerText)
          ? { contentType: "application/json" }
          : undefined;
        const query = [
          ...new Set([...handlerText.matchAll(/req\.query\.([A-Za-z_]\w*)/g)].map((x) => x[1]!)),
        ];
        const init = bindings.get(m.file)?.get(appName) ?? "";
        const framework = init.startsWith("fastify")
          ? "fastify"
          : init.startsWith("express")
            ? "express"
            : "unknown";
        routes.push({
          id: makeId("js", methodRaw, p, m.file, m.line),
          method: methodRaw as HttpMethod,
          path: p,
          file: m.file,
          line: m.line,
          framework,
          language: "javascript",
          auth: { ...auth, confidence: auth.required ? "high" : "low" },
          body,
          params: extractParams(p),
          query: query.length ? query : undefined,
          handlerName: args[args.length - 1],
          raw: m.text,
        });
      } else if (m.ruleId === "route-object") {
        const text = m.text;
        const methodM = text.match(/method\s*:\s*['"]([A-Za-z]+)['"]/);
        const urlM = text.match(/url\s*:\s*['"]([^'"]+)['"]/);
        if (!methodM?.[1] || !urlM?.[1]) continue;
        const methodRaw = methodM[1].toUpperCase();
        if (!isHttpMethod(methodRaw)) continue;
        const p = urlM[1];
        const onRequest = /(onRequest|preHandler)\s*:/.test(text) && AUTH_HINTS.test(text);
        routes.push({
          id: makeId("js", methodRaw, p, m.file, m.line),
          method: methodRaw as HttpMethod,
          path: p,
          file: m.file,
          line: m.line,
          framework: "fastify",
          language: "javascript",
          auth: {
            required: onRequest,
            middleware: onRequest ? ["fastify-hook"] : undefined,
            confidence: onRequest ? "medium" : "low",
          },
          body: /request\.body/.test(text) ? { contentType: "application/json" } : undefined,
          params: extractParams(p),
          raw: text,
        });
      } else if (m.ruleId === "nestjs-method" || m.ruleId === "nestjs-method-bare") {
        const methodRaw = m.node.get("METHOD") ?? "";
        if (!NEST_METHODS.has(methodRaw)) continue;
        const decoratorPath =
          m.ruleId === "nestjs-method" ? stripQuotes(m.node.get("PATH") ?? "") : "";
        const enclosing = enclosingMethod(m.node);
        if (!enclosing) continue;
        const classBody = walkTo(m.node, "class_body");
        if (!classBody) continue;
        const prefix = controllerPrefix(classBody);
        const p = joinPaths(prefix, decoratorPath);
        const methodText = enclosing.node.text();
        const guards = [
          ...new Set(
            [...enclosing.decorators.join(" ").matchAll(/@UseGuards\(([^)]*)\)/g)].flatMap((x) =>
              (x[1] ?? "")
                .split(",")
                .map((g) => g.trim())
                .filter(Boolean),
            ),
          ),
        ];
        const bodyM = methodText.match(/@Body\(\)[^)]*\)?\s*[A-Za-z_:]*\s*:\s*([A-Za-z_]\w*)/);
        const queryM = methodText.match(/@Query\([^)]*\)\s*([A-Za-z_]\w*)\s*:/);
        const params = [
          ...new Set([...methodText.matchAll(/@Param\(['"]([^'"]+)['"]\)/g)].map((x) => x[1]!)),
        ];
        routes.push({
          id: makeId("js", methodRaw.toUpperCase(), p, m.file, m.line),
          method: methodRaw.toUpperCase() as HttpMethod,
          path: p,
          file: m.file,
          line: m.line,
          framework: "nestjs",
          language: "javascript",
          auth: {
            required: guards.length > 0,
            middleware: guards.length ? guards : undefined,
            confidence: guards.length ? "high" : "low",
          },
          body: bodyM?.[1]
            ? { contentType: "application/json", schemaName: bodyM[1] }
            : /@Body\(\)/.test(methodText)
              ? { contentType: "application/json" }
              : undefined,
          params: [...new Set([...extractParams(p), ...params])],
          query: queryM?.[1] ? [queryM[1]] : undefined,
          raw: methodText.slice(0, 500),
        });
      } else if (m.ruleId === "nextjs-function") {
        const name = m.node.get("NAME") ?? "";
        const isExported = walkTo(m.node, "export_statement") !== null;
        if (!isExported) continue;
        let methodRaw: string;
        let isDefault = false;
        if (isHttpMethod(name)) {
          methodRaw = name.toUpperCase();
        } else if (walkTo(m.node, "export_statement")?.text().startsWith("export default")) {
          methodRaw = "ALL";
          isDefault = true;
        } else {
          continue;
        }
        const p = deriveNextJsPath(m.file, rootPath);
        if (!p) continue;
        const text = m.node.text();
        const auth = authFromText(text);
        routes.push({
          id: makeId("js", methodRaw, p, m.file, m.line),
          method: methodRaw as HttpMethod,
          path: p,
          file: m.file,
          line: m.line,
          framework: "nextjs",
          language: "javascript",
          auth: {
            required: auth.required || /session|getServerSession/.test(text),
            middleware: auth.required ? auth.middleware : undefined,
            confidence: auth.required ? "medium" : "low",
          },
          body: /request\.json\(\)|req\.body/.test(text)
            ? { contentType: "application/json" }
            : /FormData/.test(text)
              ? { contentType: "multipart/form-data" }
              : undefined,
          params: extractParams(p),
          query: /searchParams/.test(text) ? ["searchParams"] : undefined,
          handlerName: isDefault ? name : undefined,
          raw: text,
        });
      }
    }

    return routes;
  },
};
