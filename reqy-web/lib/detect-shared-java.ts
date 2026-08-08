/**
 * Java framework detectors (Spring Boot, Micronaut, Quarkus)
 * using java-parser for AST-based route detection.
 */

import type { DetectedRoute } from "@/lib/detect-shared-types";
import {
  makeRoute,
  normalizePath,
  HTTP_METHODS_UPPER_ALL,
  HTTP_METHODS_UPPER,
} from "@/lib/detect-shared-types";

// ── Java parser lazy-load ──────────────────────────────────────────────────

// java-parser is an optional dependency whose chevrotain CST we only touch
// structurally. This minimal type keeps the AST helpers type-safe without
// requiring the package to be installed (it is stubbed in unit tests).
interface JavaCstNode {
  name?: string;
  image?: string;
  children?: Record<string, JavaCstNode[]>;
  [key: string]: unknown;
}

interface JavaParserLike {
  parse?: (source: string) => JavaCstNode;
}

let _javaParser: JavaParserLike | null = null;
async function getJavaParser(): Promise<JavaParserLike | null> {
  if (!_javaParser) {
    try {
      _javaParser = (await import("java-parser")) as unknown as JavaParserLike;
    } catch {
      return null;
    }
  }
  return _javaParser;
}

async function parseJavaSource(source: string): Promise<JavaCstNode | null> {
  if (!source || !source.trim()) return null;
  try {
    const parser = await getJavaParser();
    return parser?.parse ? parser.parse(source) : null;
  } catch {
    return null;
  }
}

// ── Java AST helpers ───────────────────────────────────────────────────────

function findJavaNodes(node: JavaCstNode | null | undefined, name: string): JavaCstNode[] {
  if (!node || typeof node !== "object") return [];
  const results: JavaCstNode[] = [];
  if (node.name === name) results.push(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) results.push(...findJavaNodes(child as JavaCstNode, name));
    } else if (value && typeof value === "object") {
      results.push(...findJavaNodes(value as JavaCstNode, name));
    }
  }
  return results;
}

function collectJavaIdentifiers(node: JavaCstNode | null | undefined): string[] {
  if (!node || typeof node !== "object") return [];
  if (node.name === "Identifier" && typeof node.image === "string") return [node.image];
  let identifiers: string[] = [];
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value)
        identifiers = identifiers.concat(collectJavaIdentifiers(child as JavaCstNode));
    } else if (value && typeof value === "object") {
      identifiers = identifiers.concat(collectJavaIdentifiers(value as JavaCstNode));
    }
  }
  return identifiers;
}

function findFirstStringLiteral(node: JavaCstNode | null | undefined): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (node.name === "StringLiteral" && typeof node.image === "string")
    return node.image.replace(/^"|"$/g, "");
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = findFirstStringLiteral(child as JavaCstNode);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findFirstStringLiteral(value as JavaCstNode);
      if (found) return found;
    }
  }
  return undefined;
}

function findLastIdentifier(node: JavaCstNode | null | undefined): string | undefined {
  const ids = collectJavaIdentifiers(node);
  return ids.length ? ids[ids.length - 1] : undefined;
}

function getJavaAnnotationName(annotation: JavaCstNode): string {
  const typeName = annotation?.children?.typeName?.[0];
  return collectJavaIdentifiers(typeName).join(".");
}

function getJavaAnnotationPairs(annotation: JavaCstNode): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = annotation?.children?.elementValuePairList?.[0]?.children?.elementValuePair;
  if (!Array.isArray(pairs)) return result;
  for (const pair of pairs) {
    const key = pair?.children?.Identifier?.[0]?.image;
    const valueNode = pair?.children?.elementValue?.[0];
    if (!key || !valueNode) continue;
    result[key] = findFirstStringLiteral(valueNode) ?? findLastIdentifier(valueNode) ?? "";
  }
  return result;
}

function getJavaAnnotationValue(annotation: JavaCstNode): string | undefined {
  const directValue = findFirstStringLiteral(annotation?.children?.elementValue?.[0]);
  if (directValue) return directValue;
  const pairs = getJavaAnnotationPairs(annotation);
  return pairs.value || pairs.path || pairs.name;
}

function getJavaAnnotationMethod(annotation: JavaCstNode): string | undefined {
  const rawName = getJavaAnnotationName(annotation);
  const name = rawName.split(".").pop()?.toUpperCase() ?? "";
  if (HTTP_METHODS_UPPER_ALL.has(name)) return name;
  if (name === "REQUESTMAPPING") {
    const pairs = getJavaAnnotationPairs(annotation);
    const method = pairs.method;
    if (typeof method === "string" && method.length > 0)
      return method.split(".").pop()?.toUpperCase() ?? "GET";
    return "GET";
  }
  if (name.endsWith("MAPPING")) return name.replace(/MAPPING$/, "") || "GET";
  return undefined;
}

function getJavaAnnotationPath(annotation: JavaCstNode): string | undefined {
  const value = getJavaAnnotationValue(annotation);
  return value ? normalizePath(value) : undefined;
}

function matchJavaClassPrefix(classNode: JavaCstNode, validNames: string[]): string {
  const annotations = findJavaNodes(classNode, "annotation");
  for (const annotation of annotations) {
    const annotationName = getJavaAnnotationName(annotation).split(".").pop() ?? "";
    if (validNames.includes(annotationName)) return getJavaAnnotationPath(annotation) ?? "";
  }
  return "";
}

// ── Spring Boot AST ────────────────────────────────────────────────────────

async function detectSpringAST(content: string): Promise<DetectedRoute[]> {
  const ast = await parseJavaSource(content);
  if (!ast) return [];
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const classDeclarations = findJavaNodes(ast, "classDeclaration");
  for (const classNode of classDeclarations) {
    const classPrefix = matchJavaClassPrefix(classNode, [
      "RequestMapping",
      "GetMapping",
      "PostMapping",
      "PutMapping",
      "DeleteMapping",
      "PatchMapping",
    ]);
    const methodDeclarations = findJavaNodes(classNode, "methodDeclaration");
    for (const methodDecl of methodDeclarations) {
      const annotations = findJavaNodes(methodDecl, "annotation");
      for (const annotation of annotations) {
        const method = getJavaAnnotationMethod(annotation);
        if (!method) continue;
        const subPath = getJavaAnnotationPath(annotation) ?? "";
        const path = normalizePath(`${classPrefix}/${subPath}`);
        const key = `${method}|${path}`;
        if (!seen.has(key)) {
          seen.add(key);
          routes.push(makeRoute(method, path, ""));
        }
      }
    }
  }
  return routes;
}

// ── Micronaut AST ──────────────────────────────────────────────────────────

async function detectMicronautAST(content: string): Promise<DetectedRoute[]> {
  const ast = await parseJavaSource(content);
  if (!ast) return [];
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const classDeclarations = findJavaNodes(ast, "classDeclaration");
  for (const classNode of classDeclarations) {
    const classPrefix = matchJavaClassPrefix(classNode, ["Controller"]);
    const methodDeclarations = findJavaNodes(classNode, "methodDeclaration");
    for (const methodDecl of methodDeclarations) {
      const annotations = findJavaNodes(methodDecl, "annotation");
      for (const annotation of annotations) {
        const method = getJavaAnnotationMethod(annotation);
        if (!method) continue;
        const subPath = getJavaAnnotationPath(annotation) ?? "";
        const path = normalizePath(`${classPrefix}/${subPath}`);
        const key = `${method}|${path}`;
        if (!seen.has(key)) {
          seen.add(key);
          routes.push(makeRoute(method, path, ""));
        }
      }
    }
  }
  return routes;
}

// ── Quarkus AST ────────────────────────────────────────────────────────────

async function detectQuarkusAST(content: string): Promise<DetectedRoute[]> {
  const ast = await parseJavaSource(content);
  if (!ast) return [];
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const classDeclarations = findJavaNodes(ast, "classDeclaration");
  for (const classNode of classDeclarations) {
    const classPrefix = matchJavaClassPrefix(classNode, ["Path"]);
    const methodDeclarations = findJavaNodes(classNode, "methodDeclaration");
    for (const methodDecl of methodDeclarations) {
      const annotations = findJavaNodes(methodDecl, "annotation");
      const pathAnnotation = annotations.find(
        (a) => (getJavaAnnotationName(a).split(".").pop() ?? "") === "Path",
      );
      const verbAnnotation = annotations.find((a) => {
        const name = (getJavaAnnotationName(a).split(".").pop() ?? "").toUpperCase();
        return HTTP_METHODS_UPPER.has(name);
      });
      if (!verbAnnotation) continue;
      const method = getJavaAnnotationMethod(verbAnnotation);
      if (!method) continue;
      const subPath = pathAnnotation ? (getJavaAnnotationPath(pathAnnotation) ?? "") : "";
      const path = normalizePath(`${classPrefix}/${subPath}`);
      const key = `${method}|${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(makeRoute(method, path, ""));
      }
    }
  }
  return routes;
}

// ── Regex fallback helpers (used when AST is unavailable) ──────────────────

function extractJavaAnnotationPath(source: string): string {
  const named = source.match(/(?:value|path)\s*=\s*['"]([^'"]+)['"]/)?.[1];
  if (named) return named;
  const parenthesized = source.match(/\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
  if (parenthesized) return parenthesized;
  // Bare annotation value, e.g. @RequestMapping("/users") -> the extracted
  // args are just the quoted string. Only treat the whole arg as a path when
  // it is entirely a quoted string, so args like `method = RequestMethod.GET`
  // or `params = "x"` do not become garbage paths.
  const bare = source.trim().match(/^['"]([^'"]*)['"]$/);
  return bare ? bare[1] : "";
}

function extractJavaRequestMethod(source: string): string | undefined {
  return source.match(/RequestMethod\.([A-Za-z]+)/)?.[1];
}

// ── Spring Boot (regex fallback) ──────────────────────────────────────────

export async function detectSpring(content: string): Promise<DetectedRoute[]> {
  const astRoutes = await detectSpringAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const classPrefix = extractJavaAnnotationPath(
    content.match(/@RequestMapping\s*\(([^)]*)\)/)?.[1] ?? "",
  );
  const MAP_RE = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(([^)]*)\))?/g;
  const seen = new Set<string>();
  for (const m of content.matchAll(MAP_RE)) {
    const args = m[2] ?? "";
    const verb = m[1] === "Request" ? extractJavaRequestMethod(args) || "GET" : m[1].toUpperCase();
    const subPath = extractJavaAnnotationPath(args);
    const path = normalizePath(`${classPrefix}/${subPath}`);
    const r = makeRoute(verb, path, "");
    const idx = m.index ?? 0;
    const preceding = content.slice(Math.max(0, idx - 400), idx);
    if (/@PreAuthorize|@Secured|@RolesAllowed|@WithMockUser/.test(preceding)) {
      r.authRequired = true;
      r.authType = "middleware";
      r.reasonings?.push("Spring @PreAuthorize / @Secured / @RolesAllowed");
    }
    const key = `${verb}|${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(r);
    }
  }
  return routes;
}

// ── Micronaut (regex fallback) ────────────────────────────────────────────

export async function detectMicronaut(content: string): Promise<DetectedRoute[]> {
  const astRoutes = await detectMicronautAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const classPrefix =
    content.match(/@Controller\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]\s*\)/)?.[1] ?? "";
  const METHOD_RE = /@(Get|Post|Put|Delete|Patch)\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]\s*\)/g;
  for (const m of content.matchAll(METHOD_RE)) {
    const verb = m[1].toUpperCase();
    const subPath = m[2] || "";
    routes.push(makeRoute(verb, normalizePath(`${classPrefix}/${subPath}`), ""));
  }
  return routes;
}

// ── Quarkus (regex fallback) ──────────────────────────────────────────────

export async function detectQuarkus(content: string): Promise<DetectedRoute[]> {
  const astRoutes = await detectQuarkusAST(content);
  if (astRoutes.length > 0) return astRoutes;
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();
  const classPrefix = content.match(/@Path\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ?? "";
  const METHOD_BLOCK_RE =
    /((?:@\w+(?:\s*\([^)]*\))?\s*)+)(?=\s*(?:public|private|protected|fun)\s)/g;
  for (const blockMatch of content.matchAll(METHOD_BLOCK_RE)) {
    const block = blockMatch[1];
    const verbMatch = block.match(/@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/);
    if (!verbMatch) continue;
    const method = verbMatch[1] === "OPTIONS" ? "GET" : verbMatch[1];
    const subPath = extractJavaAnnotationPath(block);
    const path = normalizePath(`${classPrefix}/${subPath}`);
    const key = `${method}|${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push(makeRoute(method, path, ""));
    }
  }
  return routes;
}
