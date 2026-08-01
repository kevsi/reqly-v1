/**
 * Regex-based route detectors: Express, Fastify, Koa, Hapi, Ktor, NestJS, Next.js.
 */

import ts from "typescript";
import type { DetectedRoute, HttpMethod } from "@/lib/detect-shared-types";
import {
  makeRoute,
  normalizePath,
  stripLanguageCommentsAndStrings,
  isHttpMethodName,
  HTTP_METHODS_UPPER_ALL,
  HTTP_METHODS_UPPER,
} from "@/lib/detect-shared-types";
import {
  detectExpressAST,
  detectFastifyAST,
  detectKoaAST,
  detectHapiAST,
} from "@/lib/detect-shared-js-core";
import {
  analyzeHandlerBody,
  detectAuthInArgs,
  detectBodyTypeInArgs,
  detectAuthByStatusSignal,
} from "@/lib/detect-shared-handler";

// ── Express ─────────────────────────────────────────────────────────────────

export function detectExpress(content: string): DetectedRoute[] {
  const astRoutes = detectExpressAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const appVars = new Set<string>(["app"]);
  const routerVars = new Set<string>();
  for (const m of content.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(\s*\)/g,
  )) {
    appVars.add(m[1]);
  }
  for (const m of content.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:new\s+)?(?:express\.Router|Router)\s*\(\s*\)|require\s*\(\s*['"`]express['"`]\s*\)\s*\(\s*\)|import\s*\(\s*['"`]express['"`]\s*\))/g,
  )) {
    routerVars.add(m[1]);
  }
  const isAppObject = (obj: string) => obj === "app" || appVars.has(obj);
  const isRouterObject = (obj: string) => obj === "router" || routerVars.has(obj);
  const METHOD_RE =
    /([A-Za-z_$][\w$]*)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])((?:[^'"`\\]|\\.|(?!\3)[\s\S])*?)\3\s*,?([\s\S]*?)(?=\)\s*(?:;|\n|\/\/|app\.|router\.|[A-Za-z_$][\w$]*\.)|\n\n)/g;
  for (const m of content.matchAll(METHOD_RE)) {
    try {
      const obj = m[1];
      const method = m[2].toUpperCase();
      const rawPath = m[4];
      const rawArgs = m[5] || "";
      if (!isAppObject(obj) && !isRouterObject(obj)) continue;
      const resolvedPath = rawPath.replace(/\$\{[^}]+\}/g, ":param");
      const r = makeRoute(method, resolvedPath, "");
      r.controller = obj;
      const ids: string[] = [];
      for (const idm of rawArgs.matchAll(/\b([A-Za-z_$][\w$.]*)(?=\s*[,)])/g)) {
        const id = idm[1];
        if (["function", "async", "req", "res", "next", "request", "response"].includes(id))
          continue;
        if (/^['"`\d]/.test(id)) continue;
        ids.push(id);
      }
      r.middlewareChain = ids;
      detectAuthInArgs(rawArgs, r);
      detectBodyTypeInArgs(rawArgs, r);
      const key = `${method}|${r.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(r);
      }
    } catch {}
  }
  const ROUTE_CHAIN_RE =
    /([A-Za-z_$][\w$]*)\.route\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*?)\2\s*\)\s*((?:\s*\.\s*(?:get|post|put|delete|patch|options|head|all)\s*\(\s*[\s\S]*?\))+)/g;
  for (const m of content.matchAll(ROUTE_CHAIN_RE)) {
    const obj = m[1];
    if (!isAppObject(obj) && !isRouterObject(obj)) continue;
    const rawPath = m[3];
    const chain = m[4];
    const resolvedPath = rawPath.replace(/\$\{[^}]+\}/g, ":param");
    for (const mm of chain.matchAll(/\.\s*(get|post|put|delete|patch|options|head|all)\s*\(/g)) {
      const method = mm[1].toUpperCase();
      const path = normalizePath(resolvedPath);
      const key = `${method}|${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(makeRoute(method, resolvedPath, ""));
      }
    }
  }
  const SIMPLE_RE =
    /(?:app|router|[A-Za-z_$][\w$]*)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"]+)['"]\)/g;
  for (const m of content.matchAll(SIMPLE_RE)) {
    const obj = m[0].split(".")[0];
    if (!isAppObject(obj) && !isRouterObject(obj)) continue;
    const key = `${m[1].toUpperCase()}|${normalizePath(m[2])}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(makeRoute(m[1].toUpperCase(), m[2], ""));
    }
  }
  return routes;
}

// ── Fastify ─────────────────────────────────────────────────────────────────

export function detectFastify(content: string): DetectedRoute[] {
  const astRoutes = detectFastifyAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const seen = new Set<string>();
  const INLINE_RE =
    /(?:fastify|server|app)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*?)\2/g;
  for (const m of sanitized.matchAll(INLINE_RE)) {
    const method = m[1].toUpperCase();
    const rawPath = m[3];
    const key = `${method}|${normalizePath(rawPath)}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(makeRoute(method, rawPath, ""));
    }
  }
  const ROUTE_OBJ_RE = /(?:fastify|server|app)\.route\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of sanitized.matchAll(ROUTE_OBJ_RE)) {
    const block = m[1];
    const methodMatch = block.match(/method\s*:\s*['"]([^'"]+)['"]/i);
    const urlMatch = block.match(/(?:url|path)\s*:\s*['"]([^'"]+)['"]/i);
    if (methodMatch && urlMatch) {
      const method = methodMatch[1].toUpperCase();
      const rawPath = urlMatch[1];
      const key = `${method}|${normalizePath(rawPath)}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(makeRoute(method, rawPath, ""));
      }
    }
  }
  return routes;
}

// ── Koa ─────────────────────────────────────────────────────────────────────

export function detectKoa(content: string): DetectedRoute[] {
  const astRoutes = detectKoaAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const routerVars = new Set<string>();
  for (const m of sanitized.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Router\s*\(/g,
  )) {
    routerVars.add(m[1]);
  }
  const METHOD_RE =
    /([A-Za-z_$][\w$]*)\.(get|post|put|delete|patch|options|head)\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*?)\3/g;
  const seen = new Set<string>();
  for (const m of sanitized.matchAll(METHOD_RE)) {
    const obj = m[1];
    const method = m[2].toUpperCase();
    const rawPath = m[4];
    if (obj !== "router" && !routerVars.has(obj)) continue;
    const key = `${method}|${normalizePath(rawPath)}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(makeRoute(method, rawPath, ""));
    }
  }
  return routes;
}

// ── Ktor ────────────────────────────────────────────────────────────────────

export function detectKtor(content: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const seen = new Set<string>();
  const DIRECT_RE = /\b(get|post|put|delete|patch|options|head)\s*\(\s*(['"])([^'"\s][^'"\)]*)\2/g;
  for (const m of sanitized.matchAll(DIRECT_RE)) {
    const method = m[1].toUpperCase();
    const rawPath = m[3];
    const key = `${method}|${normalizePath(rawPath)}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(makeRoute(method, rawPath, ""));
    }
  }
  const PREFIX_RE = /route\s*\(\s*(['"])([^'"\s][^'"\)]*)\1\s*\)\s*\{([\s\S]*?)\}/g;
  for (const m of sanitized.matchAll(PREFIX_RE)) {
    const prefix = m[2];
    const block = m[3];
    for (const inner of block.matchAll(DIRECT_RE)) {
      const method = inner[1].toUpperCase();
      const rawPath = normalizePath(`${prefix}/${inner[3]}`);
      const key = `${method}|${rawPath}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(makeRoute(method, rawPath, ""));
      }
    }
  }
  return routes;
}

// ── Hapi ────────────────────────────────────────────────────────────────────

export function detectHapi(content: string): DetectedRoute[] {
  const astRoutes = detectHapiAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const sanitized = stripLanguageCommentsAndStrings(content);
  const seen = new Set<string>();
  const ROUTE_OBJ_RE = /server\.route\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of sanitized.matchAll(ROUTE_OBJ_RE)) {
    const block = m[1];
    const methodMatch = block.match(/method\s*:\s*['"]([^'"]+)['"]/i);
    const pathMatch = block.match(/path\s*:\s*['"]([^'"]+)['"]/i);
    if (methodMatch && pathMatch) {
      const method = methodMatch[1].toUpperCase();
      const rawPath = pathMatch[1];
      const key = `${method}|${normalizePath(rawPath)}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(makeRoute(method, rawPath, ""));
      }
    }
  }
  const ROUTE_ARRAY_RE = /server\.route\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
  for (const m of sanitized.matchAll(ROUTE_ARRAY_RE)) {
    const arrayBlock = m[1];
    const ITEMS_RE = /\{([\s\S]*?)\}/g;
    for (const item of arrayBlock.matchAll(ITEMS_RE)) {
      const block = item[1];
      const methodMatch = block.match(/method\s*:\s*['"]([^'"]+)['"]/i);
      const pathMatch = block.match(/path\s*:\s*['"]([^'"]+)['"]/i);
      if (methodMatch && pathMatch) {
        const method = methodMatch[1].toUpperCase();
        const rawPath = pathMatch[1];
        const key = `${method}|${normalizePath(rawPath)}`;
        if (!seen.has(key)) {
          seen.add(key);
          routes.push(makeRoute(method, rawPath, ""));
        }
      }
    }
  }
  return routes;
}

// ── NestJS ──────────────────────────────────────────────────────────────────

function getDecoratorName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function parseNestJSDecoratorPath(decorator: ts.Decorator): string | null {
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression)) return null;
  const arg = expression.arguments[0];
  if (!arg) return "";

  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : null;
      if (key !== "path") continue;
      const value = prop.initializer;
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    }
  }

  return "";
}

function parseNestJSMethodDecorator(
  decorator: ts.Decorator,
): { method: string; path: string } | null {
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression)) return null;
  const name = getDecoratorName(expression.expression);
  if (!name) return null;
  const method = name.toUpperCase();
  if (!HTTP_METHODS_UPPER_ALL.has(method)) return null;
  const path = parseNestJSDecoratorPath(decorator) ?? "";
  return { method: method === "ALL" ? "GET" : method, path };
}

function hasNestJSAuthDecorator(decorators: readonly ts.Decorator[] | undefined): boolean {
  if (!decorators) return false;
  return decorators.some((decorator) => {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) return false;
    const name = getDecoratorName(expression.expression);
    return name === "UseGuards" || name === "Roles" || name === "UseInterceptors";
  });
}

function getDecoratorsForAST(node: ts.Node): readonly ts.Decorator[] {
  const decorators: ts.Decorator[] = [];
  for (const child of node.getChildren()) {
    if (child.kind === ts.SyntaxKind.SyntaxList) {
      for (const inner of child.getChildren()) {
        if (ts.isDecorator(inner)) decorators.push(inner);
      }
    }
  }
  return decorators;
}

function detectNestJSAST(content: string): DetectedRoute[] {
  const sourceFile = ts.createSourceFile(
    "detect.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node)) {
      const classDecorators = getDecoratorsForAST(node);
      const controllerPrefix =
        classDecorators.flatMap((decorator) => {
          const expression = decorator.expression;
          const name = ts.isCallExpression(expression)
            ? getDecoratorName(expression.expression)
            : getDecoratorName(expression);
          if (name !== "Controller") return [];
          const path = parseNestJSDecoratorPath(decorator);
          return path === null ? [] : [path ?? ""];
        })[0] ?? "";

      const classAuth = hasNestJSAuthDecorator(classDecorators);

      for (const member of node.members) {
        const methodDecorators = getDecoratorsForAST(member);
        if (!ts.isMethodDeclaration(member) || !methodDecorators.length) continue;
        for (const decorator of methodDecorators) {
          const parsed = parseNestJSMethodDecorator(decorator);
          if (!parsed) continue;
          const route = makeRoute(
            parsed.method as HttpMethod,
            normalizePath(`${controllerPrefix}/${parsed.path}`) || "/",
            "",
          );

          const hasBodyDecorator = /@Body\s*\(/.test(member.getText(sourceFile));
          if (hasBodyDecorator) {
            route.bodyType = "json";
            const methodText = member.getText(sourceFile);
            analyzeHandlerBody(methodText, route, content);
          }
          route.authRequired = classAuth || hasNestJSAuthDecorator(methodDecorators);
          if (route.authRequired) {
            route.authType = "middleware";
            route.reasonings?.push("NestJS @UseGuards / @Roles / @UseInterceptors");
          }
          const key = `${route.method}|${route.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            routes.push(route);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

export function detectNestJS(content: string): DetectedRoute[] {
  const astRoutes = detectNestJSAST(content);
  if (astRoutes.length > 0) return astRoutes;

  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const CLASS_RE =
    /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path\s*:\s*['"`]([^'"`]*)['"`][^}]*\})?\s*\)\s*(?:export\s+)?class\s+[A-Za-z_]\w*\s*\{([\s\S]*?)(?=\n\s*@Controller|$)/gi;
  for (const m of content.matchAll(CLASS_RE)) {
    const classPrefix = m[1] || m[2] || "";
    const classBody = m[3];
    const METHOD_RE =
      /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path\s*:\s*['"`]([^'"`]*)['"`][^}]*\})?\s*\)/g;
    for (const mm of classBody.matchAll(METHOD_RE)) {
      const method = mm[1].toUpperCase() === "ALL" ? "GET" : mm[1].toUpperCase();
      const subPath = mm[2] ?? mm[3] ?? "";
      const path = normalizePath(`${classPrefix}/${subPath}`);
      const r = makeRoute(method, path || "/", "");
      const idx = mm.index ?? 0;
      const preceding = classBody.slice(Math.max(0, idx - 300), idx);
      if (/@UseGuards\s*\(|@Roles\s*\(|@UseInterceptors\s*\(/.test(preceding)) {
        r.authRequired = true;
        r.authType = "middleware";
        r.reasonings?.push("NestJS @UseGuards / @Roles / @UseInterceptors");
      }
      if (/@Body\s*\(/.test(preceding) || /@Body\s*\(/.test(classBody.slice(idx, idx + 200))) {
        r.bodyType = "json";
        const handlerText = classBody.slice(idx, idx + 500);
        analyzeHandlerBody(handlerText, r, content);
      }
      const key = `${r.method}|${r.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(r);
      }
    }
  }

  if (routes.length === 0) {
    const METHOD_RE =
      /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path\s*:\s*['"`]([^'"`]*)['"`][^}]*\})?\s*\)/g;
    for (const m of content.matchAll(METHOD_RE)) {
      const method = m[1].toUpperCase() === "ALL" ? "GET" : m[1].toUpperCase();
      const subPath = m[2] ?? m[3] ?? "";
      const r = makeRoute(method, subPath || "/", "");
      const idx = m.index ?? 0;
      const preceding = content.slice(Math.max(0, idx - 300), idx);
      if (/@UseGuards\s*\(|@Roles\s*\(|@UseInterceptors\s*\(/.test(preceding)) {
        r.authRequired = true;
        r.authType = "middleware";
        r.reasonings?.push("NestJS @UseGuards / @Roles / @UseInterceptors");
      }
      if (/@Body\s*\(/.test(preceding) || /@Body\s*\(/.test(content.slice(idx, idx + 200))) {
        r.bodyType = "json";
        const handlerText = content.slice(idx, idx + 500);
        analyzeHandlerBody(handlerText, r, content);
      }
      const key = `${r.method}|${r.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(r);
      }
    }
  }

  return routes;
}

// ── Next.js routers ─────────────────────────────────────────────────────────

export function detectNextjsAppRouter(f: { path: string; content: string }): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const normalizedPath = f.path.replace(/\\/g, "/");
  if (!/\/app\/api\//.test(normalizedPath)) return routes;
  if (!/route\.(ts|js|tsx|jsx)$/.test(normalizedPath)) return routes;
  const rel = normalizedPath.split("/app/api/")[1];
  let urlPath =
    "/" +
    rel
      .replace(/\/route\.(ts|js|tsx|jsx)$/, "")
      .replace(/index$/, "")
      .replace(/\[\.\.\.([^\]]+)\]/g, ":$1*")
      .replace(/\[([^\]]+)\]/g, ":$1")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");
  if (urlPath === "") urlPath = "/";
  urlPath = `/api${urlPath}`;
  const EXPORT_METHOD_RE =
    /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b([\s\S]{0,2000}?)(?=\nexport|\nconst|\nfunction|$)/g;
  for (const m of f.content.matchAll(EXPORT_METHOD_RE)) {
    const method = m[1];
    const body = m[2] || "";
    const r = makeRoute(method, urlPath, "");
    r.sourceFile = f.path;
    analyzeHandlerBody(body, r, f.content);
    routes.push(r);
  }
  return routes;
}

export function detectNextjsPagesRouter(f: { path: string; content: string }): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const normalizedPath = f.path.replace(/\\/g, "/");
  if (!/\/pages\/api\//.test(normalizedPath)) return routes;
  if (!/\.(ts|js|tsx|jsx)$/.test(normalizedPath)) return routes;
  const rel = normalizedPath.split("/pages/api/")[1];
  const urlPath =
    "/api/" +
    rel
      .replace(/\.(ts|js|tsx|jsx)$/, "")
      .replace(/\/index$/, "")
      .replace(/\[\.\.\.([^\]]+)\]/g, ":$1*")
      .replace(/\[([^\]]+)\]/g, ":$1")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");
  const content = f.content;
  const methods = new Set<string>();
  for (const m of content.matchAll(/case\s+['"](\w+)['"]\s*:/g)) {
    const verb = m[1].toUpperCase();
    if (HTTP_METHODS_UPPER.has(verb)) methods.add(verb);
  }
  for (const m of content.matchAll(/req\.method\s*===?\s*['"]([^'"]+)['"]/g)) {
    methods.add(m[1].toUpperCase());
  }
  if (methods.size === 0) methods.add("GET");
  for (const method of methods) {
    const r = makeRoute(method, urlPath, "");
    r.sourceFile = f.path;
    analyzeHandlerBody(content, r, content);
    routes.push(r);
  }
  return routes;
}
