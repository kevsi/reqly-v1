/**
 * Shared types, constants, and helpers for route detection.
 */

import type { HttpMethod } from "@/lib/types";
export type { HttpMethod };

// ── HTTP method constants (used across JS / Java / etc.) ──────────────────

export const HTTP_METHODS_LOWER = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
]);
export const HTTP_METHODS_UPPER = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
]);
export const HTTP_METHODS_UPPER_ALL = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
  "ALL",
]);

export function isHttpMethodName(name: string): boolean {
  return HTTP_METHODS_LOWER.has(name.toLowerCase()) || name.toLowerCase() === "all";
}

export interface DetectedRoute {
  name: string;
  method: HttpMethod;
  path: string;
  headers: { key: string; value: string }[];
  body: string;
  bodyType: "json" | "form" | "none";
  authRequired: boolean;
  description: string;
  sourceFile: string;
  controller?: string | object | null;
  middlewareChain?: string[];
  authType?:
    | "none"
    | "bearer"
    | "basic"
    | "oauth"
    | "api-key"
    | "jwt"
    | "session"
    | "custom"
    | "middleware"
    | "cookie"
    | "passport"
    | null;
  reasonings?: string[];
  actuallyUsedByFrontend?: boolean;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  inferredUsageFrequency?: number | null;
  reachable?: boolean;
  detectedIssues?: string[];
  requiredBodyFields?: string[];
  bodyFieldTypes?: Record<string, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const FRAMEWORK_FILE_EXTENSIONS: Record<string, string[]> = {
  fastapi: [".py"],
  flask: [".py"],
  django: [".py"],
  express: [".js", ".ts", ".jsx", ".tsx"],
  nextjs: [".js", ".ts", ".jsx", ".tsx"],
  nestjs: [".js", ".ts"],
  laravel: [".php"],
  rails: [".rb"],
  spring: [".java", ".kt"],
  aspnet: [".cs"],
  go: [".go"],
  fastify: [".js", ".ts"],
  hapi: [".js", ".ts"],
  koa: [".js", ".ts"],
  rust: [".rs"],
  swift: [".swift"],
  elixir: [".ex", ".exs"],
  haskell: [".hs"],
  micronaut: [".java", ".kt"],
  quarkus: [".java", ".kt"],
  tornado: [".py"],
  sanic: [".py"],
  starlette: [".py"],
  litestar: [".py"],
  aiohttp: [".py"],
  falcon: [".py"],
  actix: [".rs"],
  axum: [".rs"],
  rocket: [".rs"],
  sinatra: [".rb"],
};

export const LANGUAGE_EXTENSION_MAP: Record<string, string[]> = {
  JavaScript: ["js", "jsx", "ts", "tsx"],
  Python: ["py"],
  PHP: ["php"],
  Go: ["go"],
  Java: ["java"],
  Ruby: ["rb"],
  CSharp: ["cs"],
  Kotlin: ["kt", "kts"],
  Swift: ["swift"],
  Rust: ["rs"],
  Elixir: ["ex", "exs"],
  Haskell: ["hs"],
};

export const IGNORED_FOLDERS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "vendor",
  ".turbo",
  "coverage",
  ".cache",
  "storybook-static",
  ".husky",
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "fixtures",
  "mocks",
  "__mocks__",
  "stubs",
  "examples",
  "benchmark",
  "benchmarks",
];

export const NON_ROUTE_PATH_SEGMENTS = [
  "/test/",
  "/tests/",
  "/__tests__/",
  "/spec/",
  "/specs/",
  "/e2e/",
  "/fixtures/",
  "/mocks/",
  "/__mocks__/",
  "/stubs/",
  "/examples/",
  "/benchmark/",
  "/benchmarks/",
  "/scripts/",
  "/tools/",
  "/cli/",
  "/lib/request.",
  "/lib/response.",
  "/lib/router.",
  "/lib/router/",
  "/lib/middleware/",
  "/lib/utils.",
  "/lib/helpers.",
  "/lib/core.",
  "/lib/common.",
  "/lib/application.",
  "/lib/express.",
  "/internals/",
  "/internal/",
  "webpack.config",
  "vite.config",
  "rollup.config",
  "jest.config",
  "vitest.config",
  "babel.config",
  ".test.",
  ".spec.",
  "-test.",
  "-spec.",
  ".stories.",
  ".story.",
];

// ── Helpers ────────────────────────────────────────────────────────────────

export function isNonRouteFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return NON_ROUTE_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

export function normalizePath(p: string): string {
  let n = p.trim();
  if (!n.startsWith("/")) n = "/" + n;
  n = n
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/\{([a-zA-Z_]\w*)\}/g, ":$1")
    .replace(/<([a-zA-Z_]\w*)(?::[^>]+)?>/g, ":$1")
    .replace(/:([a-zA-Z_]\w*)/g, ":$1")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return n === "" ? "/" : n;
}

export function escapeRegExpStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function makeRoute(method: string, routePath: string, description: string): DetectedRoute {
  return {
    name: "",
    method: method as DetectedRoute["method"],
    path: normalizePath(routePath),
    headers: [],
    body: "",
    bodyType: "none",
    authRequired: false,
    description,
    sourceFile: "",
    controller: null,
    middlewareChain: [],
    authType: null,
    actuallyUsedByFrontend: false,
    reachable: true,
    confidence: "LOW",
    reasonings: [],
    detectedIssues: [],
  };
}

export function stripLanguageCommentsAndStrings(code: string): string {
  return code
    .replace(/('{3}|"{3})[\s\S]*?\1/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/#.*$/gm, " ")
    .replace(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, " ");
}

export function isRelevantFile(filePath: string, framework: string): boolean {
  if (framework === "unknown") return true;
  const exts = FRAMEWORK_FILE_EXTENSIONS[framework];
  if (!exts) return true;
  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  return exts.includes(ext);
}
