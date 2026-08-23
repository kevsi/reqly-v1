//! Mapping between analyser-api's JSON output (`analyser scan --format json`)
//! and Reqly's `SavedProject` / `DetectedRoute` shapes.
//!
//! analyser-api owns route detection + auth inference (ast-grep based, more
//! complete than Reqly's in-app detector). Reqly keeps only what analyser-api
//! does not provide: frontend-usage correlation and confidence scoring (done
//! in `lib/project-analyzer.ts` after this mapping).

import type { SavedProject } from "@/lib/types";
import type { DetectedRoute, HttpMethod } from "@/lib/detect-shared-types";

// ── analyser-api JSON shapes (mirror of @analyser/core AnalysisResult) ─────

export interface AnalyserAuth {
  required: boolean;
  type?: string;
  middleware?: string[];
  confidence: "high" | "medium" | "low";
}

export interface AnalyserBody {
  contentType?: string;
  schemaName?: string;
  raw?: string;
}

export interface AnalyserRoute {
  id: string;
  method: HttpMethod | "ALL";
  path: string;
  file: string;
  line: number;
  framework: string;
  language: string;
  auth: AnalyserAuth;
  body?: AnalyserBody;
  params?: string[];
  query?: string[];
  handlerName?: string;
  raw?: string;
}

export interface AnalyserAnalysis {
  projectName: string;
  rootPath: string;
  scannedAt: string;
  languagesDetected: string[];
  frameworksDetected: string[];
  totalRoutes: number;
  routesWithAuth: number;
  routesWithoutAuth: number;
  stats: {
    total: number;
    withAuth: number;
    withoutAuth: number;
    confidence: { high: number; medium: number; low: number };
  };
  routes: AnalyserRoute[];
  warnings: string[];
}

// ── Mapping ───────────────────────────────────────────────────────────────

const AUTH_TYPES = new Set([
  "none",
  "bearer",
  "basic",
  "oauth",
  "api-key",
  "jwt",
  "session",
  "custom",
  "middleware",
  "cookie",
  "passport",
]);

function mapAuthType(type: string | undefined): DetectedRoute["authType"] {
  if (!type) return undefined;
  const normalized = type.toLowerCase();
  return (AUTH_TYPES.has(normalized) ? normalized : "custom") as DetectedRoute["authType"];
}

function mapBodyType(contentType: string | undefined): DetectedRoute["bodyType"] {
  if (!contentType) return "none";
  const ct = contentType.toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("form") || ct.includes("multipart") || ct.includes("urlencoded")) return "form";
  return "none";
}

function mapConfidence(confidence: "high" | "medium" | "low"): "HIGH" | "MEDIUM" | "LOW" {
  return confidence.toUpperCase() as "HIGH" | "MEDIUM" | "LOW";
}

function mapRoute(route: AnalyserRoute): DetectedRoute {
  return {
    name: route.handlerName ?? `${route.method} ${route.path || "/"}`,
    method: route.method === "ALL" ? "GET" : route.method,
    path: route.path || "/",
    headers: [],
    body: route.body?.raw ?? "",
    bodyType: mapBodyType(route.body?.contentType),
    authRequired: route.auth.required,
    description: "",
    sourceFile: route.file,
    controller: route.handlerName ?? undefined,
    middlewareChain: route.auth.middleware ?? [],
    authType: mapAuthType(route.auth.type),
    confidence: mapConfidence(route.auth.confidence),
  };
}

/**
 * Converts an analyser-api scan result into a Reqly `SavedProject`.
 * Pure function — no I/O, no Tauri dependency (unit-tested in isolation).
 */
export function analysisResultToSavedProject(
  result: AnalyserAnalysis,
  mode: SavedProject["mode"],
  folderPath: string,
): SavedProject {
  return {
    id: `proj-${Date.now()}`,
    name: result.projectName || (folderPath.split(/[/\\]/).filter(Boolean).pop() ?? "Projet"),
    framework: result.frameworksDetected[0] ?? "unknown",
    language: result.languagesDetected[0],
    folderPath,
    routes: result.routes.map(mapRoute),
    analyzedAt: result.scannedAt || new Date().toISOString(),
    mode,
    warnings: result.warnings,
  };
}
