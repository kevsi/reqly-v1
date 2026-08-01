/**
 * TypeScript AST helpers and AST-based route detectors for Express / Fastify / Koa / Hapi.
 */

import ts from "typescript";
import type { DetectedRoute } from "@/lib/detect-shared-types";
import { makeRoute, normalizePath } from "@/lib/detect-shared-types";
import { isHttpMethodName } from "@/lib/detect-shared-types";
import { analyzeHandlerBody } from "@/lib/detect-shared-handler";

// ── AST helpers ────────────────────────────────────────────────────────────

export function parseTSContent(content: string): ts.SourceFile {
  return ts.createSourceFile("detect.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function getStringLiteralValue(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      text += ":param";
      text += span.literal.text;
    }
    return text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = getStringLiteralValue(node.left);
    const right = getStringLiteralValue(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

export function getObjectLiteralPropertyString(
  node: ts.ObjectLiteralExpression,
  key: string,
): string | null {
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
    if (name !== key) continue;
    return getStringLiteralValue(prop.initializer);
  }
  return null;
}

export function getObjectLiteralPropertyNode(
  node: ts.ObjectLiteralExpression,
  key: string,
): ts.Expression | undefined {
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
    if (name !== key) continue;
    return prop.initializer;
  }
  return undefined;
}

// ── Express AST ─────────────────────────────────────────────────────────────

export function detectExpressAST(content: string): DetectedRoute[] {
  const sourceFile = parseTSContent(content);
  const appVars = new Set<string>(["app"]);
  const routerVars = new Set<string>(["router"]);
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  function addRoute(method: string, path: string, middlewares?: string[], handlerNode?: ts.Node) {
    const normalized = normalizePath(path);
    const key = `${method}|${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      const route = makeRoute(method as DetectedRoute["method"], normalized, "");
      if (middlewares && middlewares.length > 0) {
        route.middlewareChain = middlewares;
        route.reasonings?.push("Middleware inlines detectes dans la declaration de route");
        if (
          middlewares.some((m) =>
            /auth|jwt|token|passport|session|guard|verify|secure|protect/i.test(m),
          )
        ) {
          route.authRequired = true;
          route.authType = "middleware";
        }
      }
      if (
        handlerNode &&
        (ts.isFunctionExpression(handlerNode) || ts.isArrowFunction(handlerNode))
      ) {
        const handlerText = handlerNode.getText(sourceFile);
        analyzeHandlerBody(handlerText, route, content);
      }
      routes.push(route);
    }
  }

  function extractRoutePathFromChain(chainExpr: ts.Expression): string | null {
    if (ts.isCallExpression(chainExpr) && ts.isPropertyAccessExpression(chainExpr.expression)) {
      const innerCall = chainExpr.expression.expression;
      const propName = chainExpr.expression.name.text;
      if (propName === "route" && ts.isCallExpression(innerCall)) {
        return getStringLiteralValue(innerCall.arguments[0]);
      }
      if (propName === "route" && ts.isIdentifier(innerCall)) {
        return getStringLiteralValue(chainExpr.arguments[0]);
      }
      if (propName === "all") return null;
      return extractRoutePathFromChain(innerCall);
    }
    return null;
  }

  function getMiddlewaresFromCall(node: ts.CallExpression): string[] {
    const mws: string[] = [];
    for (let i = 1; i < node.arguments.length; i++) {
      const arg = node.arguments[i];
      if (ts.isIdentifier(arg)) {
        mws.push(arg.text);
      } else if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
        mws.push(arg.expression.text);
      } else if (ts.isStringLiteral(arg)) {
        mws.push(arg.text);
      }
    }
    return mws;
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "express"
      ) {
        appVars.add(node.name.text);
      }
      if (
        ts.isCallExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === "Router"
      ) {
        routerVars.add(node.name.text);
      }
      if (
        ts.isNewExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "Router"
      ) {
        routerVars.add(node.name.text);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      const receiver = node.expression.expression;
      const pathArg = getStringLiteralValue(node.arguments[0]);

      if (pathArg && isHttpMethodName(methodName)) {
        if (
          ts.isIdentifier(receiver) &&
          (appVars.has(receiver.text) || routerVars.has(receiver.text))
        ) {
          const mws = getMiddlewaresFromCall(node);
          const handler = node.arguments[node.arguments.length - 1];
          addRoute(methodName.toUpperCase(), pathArg, mws.length > 0 ? mws : undefined, handler);
        } else if (ts.isCallExpression(receiver)) {
          const chainedPath = extractRoutePathFromChain(receiver);
          if (chainedPath) {
            const mws = getMiddlewaresFromCall(node);
            const handler = node.arguments[node.arguments.length - 1];
            addRoute(
              methodName.toUpperCase(),
              chainedPath,
              mws.length > 0 ? mws : undefined,
              handler,
            );
          }
        }
      }

      if (
        methodName === "route" &&
        pathArg &&
        ts.isIdentifier(receiver) &&
        (appVars.has(receiver.text) || routerVars.has(receiver.text))
      ) {
        const routePath = pathArg;
        let current: ts.Node = node.parent;
        while (current) {
          if (
            ts.isPropertyAccessExpression(current) &&
            isHttpMethodName(current.name.text) &&
            ts.isCallExpression(current.parent)
          ) {
            const callExpr = current.parent as ts.CallExpression;
            const mws = getMiddlewaresFromCall(callExpr);
            const handler = callExpr.arguments[callExpr.arguments.length - 1];
            addRoute(
              current.name.text.toUpperCase(),
              routePath,
              mws.length > 0 ? mws : undefined,
              handler,
            );
            current = callExpr.parent;
          } else {
            break;
          }
        }
      }

      if (
        methodName === "use" &&
        pathArg &&
        ts.isIdentifier(receiver) &&
        (appVars.has(receiver.text) || routerVars.has(receiver.text))
      ) {
        for (let i = 1; i < node.arguments.length; i++) {
          const arg = node.arguments[i];
          if (ts.isIdentifier(arg) && routerVars.has(arg.text)) {
            const subRouterPath = pathArg;
            const connRoutes: { method: string; path: string }[] = [];
            ts.forEachChild(sourceFile, (child) => {
              if (ts.isExpressionStatement(child) && ts.isCallExpression(child.expression)) {
                const expr = child.expression;
                if (
                  ts.isPropertyAccessExpression(expr.expression) &&
                  ts.isIdentifier(expr.expression.expression) &&
                  expr.expression.expression.text === arg.text
                ) {
                  const m = expr.expression.name.text;
                  if (isHttpMethodName(m)) {
                    const p = getStringLiteralValue(expr.arguments[0]);
                    if (p) connRoutes.push({ method: m.toUpperCase(), path: p });
                  }
                }
              }
            });
            for (const cr of connRoutes) {
              addRoute(cr.method, normalizePath(`${subRouterPath}/${cr.path}`));
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

// ── Fastify AST ─────────────────────────────────────────────────────────────

export function detectFastifyAST(content: string): DetectedRoute[] {
  const sourceFile = parseTSContent(content);
  const appNames = new Set<string>(["fastify", "app", "server"]);
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  function addRoute(method: string, path: string, handlerNode?: ts.Node) {
    const normalized = normalizePath(path);
    const key = `${method}|${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      const route = makeRoute(method as DetectedRoute["method"], normalized, "");
      if (
        handlerNode &&
        (ts.isFunctionExpression(handlerNode) || ts.isArrowFunction(handlerNode))
      ) {
        const handlerText = handlerNode.getText(sourceFile);
        analyzeHandlerBody(handlerText, route, content);
      }
      routes.push(route);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "fastify"
      ) {
        appNames.add(node.name.text);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      const receiver = node.expression.expression;
      const pathArg = getStringLiteralValue(node.arguments[0]);

      if (
        pathArg &&
        ts.isIdentifier(receiver) &&
        appNames.has(receiver.text) &&
        isHttpMethodName(methodName)
      ) {
        const handler = node.arguments[node.arguments.length - 1];
        addRoute(methodName.toUpperCase(), pathArg, handler);
      }

      if (
        methodName === "route" &&
        ts.isIdentifier(receiver) &&
        appNames.has(receiver.text) &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const config = node.arguments[0];
        const url =
          getObjectLiteralPropertyString(config, "url") ||
          getObjectLiteralPropertyString(config, "path");
        const method = getObjectLiteralPropertyString(config, "method");
        if (url) {
          if (method) {
            addRoute(method.toUpperCase(), url);
          } else {
            addRoute("GET", url);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

// ── Koa AST ─────────────────────────────────────────────────────────────────

export function detectKoaAST(content: string): DetectedRoute[] {
  const sourceFile = parseTSContent(content);
  const routerNames = new Set<string>(["router"]);
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  function addRoute(method: string, path: string, handlerNode?: ts.Node) {
    const normalized = normalizePath(path);
    const key = `${method}|${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      const route = makeRoute(method as DetectedRoute["method"], normalized, "");
      if (
        handlerNode &&
        (ts.isFunctionExpression(handlerNode) || ts.isArrowFunction(handlerNode))
      ) {
        const handlerText = handlerNode.getText(sourceFile);
        analyzeHandlerBody(handlerText, route, content);
      }
      routes.push(route);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (
        (ts.isNewExpression(init) || ts.isCallExpression(init)) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "Router"
      ) {
        routerNames.add(node.name.text);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      const receiver = node.expression.expression;
      const pathArg = getStringLiteralValue(node.arguments[0]);
      if (
        pathArg &&
        ts.isIdentifier(receiver) &&
        routerNames.has(receiver.text) &&
        isHttpMethodName(methodName)
      ) {
        const handler = node.arguments[node.arguments.length - 1];
        addRoute(methodName.toUpperCase(), pathArg, handler);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

// ── Hapi AST ────────────────────────────────────────────────────────────────

export function detectHapiAST(content: string): DetectedRoute[] {
  const sourceFile = parseTSContent(content);
  const serverNames = new Set<string>(["server"]);
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  function addRoute(method: string, path: string, handlerNode?: ts.Node) {
    const normalized = normalizePath(path);
    const key = `${method}|${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      const route = makeRoute(method as DetectedRoute["method"], normalized, "");
      if (
        handlerNode &&
        (ts.isFunctionExpression(handlerNode) || ts.isArrowFunction(handlerNode))
      ) {
        const handlerText = handlerNode.getText(sourceFile);
        analyzeHandlerBody(handlerText, route, content);
      }
      routes.push(route);
    }
  }

  function getHapiHandler(config: ts.ObjectLiteralExpression): ts.Node | undefined {
    const handlerProp = getObjectLiteralPropertyNode(config, "handler");
    if (handlerProp && (ts.isFunctionExpression(handlerProp) || ts.isArrowFunction(handlerProp)))
      return handlerProp;
    const optionsProp = getObjectLiteralPropertyNode(config, "options");
    if (optionsProp && ts.isObjectLiteralExpression(optionsProp)) {
      const nestedHandler = getObjectLiteralPropertyNode(optionsProp, "handler");
      if (
        nestedHandler &&
        (ts.isFunctionExpression(nestedHandler) || ts.isArrowFunction(nestedHandler))
      )
        return nestedHandler;
    }
    return undefined;
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (
        ts.isNewExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === "Server"
      ) {
        serverNames.add(node.name.text);
      }
      if (
        ts.isCallExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === "server"
      ) {
        serverNames.add(node.name.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "route"
    ) {
      const receiver = node.expression.expression;
      if (
        ts.isIdentifier(receiver) &&
        serverNames.has(receiver.text) &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const config = node.arguments[0];
        const method = getObjectLiteralPropertyString(config, "method") || "GET";
        const path =
          getObjectLiteralPropertyString(config, "path") ||
          getObjectLiteralPropertyString(config, "url");
        const handler = getHapiHandler(config);
        if (path) addRoute(method.toUpperCase(), path, handler);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}
