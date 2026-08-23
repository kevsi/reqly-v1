"use client";

import type { AIProvider, SavedProject, AnalysisMode } from "@/lib/types";
import { loadOllamaConfig } from "@/lib/config";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { isTauriAvailable } from "@/lib/tauri";
import { callAiProxyTauri } from "@/lib/tauri-ai";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import {
  type DetectedRoute,
  isNonRouteFile,
  scanFrontendApiCalls,
  correlateWithFrontendCall,
} from "./detect-shared";
import { scanBackend } from "./tauri-analyzer";
import { analysisResultToSavedProject } from "./analyser-mapping";

const MAX_FILES = 200;

// ── Public API ───────────────────────────────────────────────────────────

export type AnalysisStage = "scan" | "correlate" | "ai" | "finalize";

export async function analyzeProject(
  folderPath: string,
  mode: AnalysisMode,
  provider?: AIProvider,
  apiKey?: string,
  onStage?: (stage: AnalysisStage) => void,
): Promise<SavedProject> {
  if (mode === "ai") {
    if (provider !== "ollama" && !apiKey) throw new Error("Clé API requise pour l'analyse IA");
    return analyzeWithAI(folderPath, provider ?? "openai", apiKey, onStage);
  }
  return analyzeStatic(folderPath, onStage);
}

// ── Static analysis (analyser-api engine) ────────────────────────────────

/**
 * Static route detection is delegated to analyser-api (ast-grep, multi-language:
 * JS/TS, Rust, Python, Go). Reqly only adds what analyser-api does not provide:
 * frontend-usage correlation and confidence scoring.
 */
async function analyzeStatic(
  folderPath: string,
  onStage?: (stage: AnalysisStage) => void,
): Promise<SavedProject> {
  onStage?.("scan");
  const analysis = await scanBackend(folderPath);
  const project = analysisResultToSavedProject(analysis, "static", folderPath);

  // ── Frontend API call correlation (Reqly value-add) ───────────────────
  onStage?.("correlate");
  const filePaths = await getFiles(folderPath);
  const files: { path: string; content: string }[] = [];
  for (const fp of filePaths) {
    try {
      const content = await readTextFile(fp);
      files.push({ path: fp, content });
    } catch {
      /* skip unreadable file */
    }
  }
  const filteredFiles = files.filter((f) => !isNonRouteFile(f.path));
  const calledPaths = scanFrontendApiCalls(filteredFiles);

  // ── Confidence scoring on top of analyser-api detection ────────────────
  for (const r of project.routes) {
    for (const called of calledPaths) {
      if (correlateWithFrontendCall(r.path, called)) {
        r.actuallyUsedByFrontend = true;
        r.reasonings = [...(r.reasonings || []), `Référencé par appel frontend: ${called}`];
        break;
      }
    }

    let score = 0;
    if (r.authRequired) score += 3;
    if (r.actuallyUsedByFrontend) score += 2;
    if (r.bodyType && r.bodyType !== "none") score += 1;
    if ((r.middlewareChain || []).length > 0) score += 1;
    if ((r.reasonings || []).length > 1) score += 1;
    r.confidence = score >= 5 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
  }

  return project;
}

// ── Recursive file walker (Tauri-dependent) ────────────────────────────────

async function getFiles(folderPath: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const results: string[] = [];
  try {
    const entries = await readDir(folderPath);
    for (const entry of entries) {
      if (results.length >= MAX_FILES) break;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory) {
        results.push(...(await getFiles(`${folderPath}/${entry.name}`, depth + 1)));
      } else if (entry.isFile) {
        results.push(`${folderPath}/${entry.name}`);
      }
      if (results.length >= MAX_FILES) break;
    }
  } catch (err) {
    if (depth === 0) throw err;
  }
  return results;
}

// ── AI analysis ────────────────────────────────────────────────────────────

export async function analyzeWithAI(
  folderPath: string,
  provider: AIProvider,
  apiKey?: string,
  onStage?: (stage: AnalysisStage) => void,
): Promise<SavedProject> {
  const staticProject = await analyzeStatic(folderPath, onStage);
  const filePaths = await getFiles(folderPath);
  const files: { path: string; content: string }[] = [];
  for (const fp of filePaths) {
    try {
      const content = await readTextFile(fp);
      files.push({ path: fp, content });
    } catch {
      // Binary or unreadable files are not required for route enrichment.
    }
  }

  onStage?.("ai");
  const aiRoutes = await enrichRoutesWithAI(staticProject.routes, provider, apiKey, files);

  return {
    ...staticProject,
    routes: aiRoutes,
    language: staticProject.language,
    mode: "ai",
    analyzedAt: new Date().toISOString(),
  };
}

async function enrichRoutesWithAI(
  routes: DetectedRoute[],
  provider: AIProvider,
  apiKey?: string,
  files: { path: string; content: string }[] = [],
): Promise<DetectedRoute[]> {
  if (routes.length === 0) return routes;
  if (provider !== "ollama" && !apiKey) return routes;

  function extractSnippet(route: DetectedRoute, maxChars = 2000): string {
    try {
      const file = files.find((f) => f.path === route.sourceFile);
      if (!file) return "";
      const content = file.content;
      const pathRegex = route.path.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/");
      const idx = content.search(new RegExp(pathRegex));
      if (idx >= 0) {
        const start = Math.max(0, idx - 600);
        const end = Math.min(content.length, idx + 1000);
        return content.slice(start, end).substring(0, maxChars);
      }
      return content.slice(0, Math.min(content.length, maxChars));
    } catch {
      return "";
    }
  }

  const routeEntries = routes.map((r) => ({
    method: r.method,
    path: r.path,
    sourceFile: r.sourceFile,
    authRequired: r.authRequired,
    authType: r.authType,
    confidence: r.confidence,
    snippet: extractSnippet(r),
  }));

  const message = `You are an API route analysis assistant. Analyze each route below and return ONLY a valid JSON array where each object has:
{
  "method": "GET|POST|PUT|DELETE|PATCH",
  "path": "/api/route/path",
  "description": "brief description",
  "authRequired": boolean,
  "authType": "cookie" | "jwt" | "passport" | "middleware" | null,
  "bodyType": "json" | "form" | "none",
  "middlewareChain": ["middleware1"],
  "controller": "controller_name" | null,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasonings": ["reason1"]
}

Routes:
${routeEntries.map((e) => `Method: ${e.method}, Path: ${e.path}, Source: ${e.sourceFile}, Current Auth: ${e.authRequired ? e.authType || "unknown" : "none"}\nSnippet:\n${e.snippet}`).join("\n---\n")}`;

  try {
    const content = await queryAI(provider, apiKey, message);
    const parsed = parseJsonResponse(content);
    if (!Array.isArray(parsed)) return routes;

    const routeMap = new Map(
      (parsed as Partial<DetectedRoute>[]).map((item) => [`${item.method}|${item.path}`, item]),
    );
    return routes.map((route) => {
      const match = routeMap.get(`${route.method}|${route.path}`);
      if (!match) return route;
      return {
        ...route,
        description: typeof match.description === "string" ? match.description : route.description,
        authRequired:
          typeof match.authRequired === "boolean" ? match.authRequired : route.authRequired,
        bodyType:
          match.bodyType === "json" || match.bodyType === "form" ? match.bodyType : route.bodyType,
        middlewareChain: Array.isArray(match.middlewareChain)
          ? match.middlewareChain
          : route.middlewareChain,
        controller: typeof match.controller === "string" ? match.controller : route.controller,
        authType: typeof match.authType === "string" ? match.authType : route.authType,
        confidence: match.confidence || route.confidence,
        reasonings: Array.isArray(match.reasonings)
          ? [...(route.reasonings || []), ...match.reasonings]
          : route.reasonings,
      };
    });
  } catch {
    return routes;
  }
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new Error("Impossible d'extraire le JSON");
    return JSON.parse(match[0]);
  }
}

async function queryAI(
  provider: AIProvider,
  apiKey: string | undefined,
  message: string,
): Promise<string> {
  const ollamaConfig = provider === "ollama" ? loadOllamaConfig() : null;

  if (isTauriAvailable()) {
    const { content } = await callAiProxyTauri({
      provider,
      apiKey,
      model:
        provider === "anthropic"
          ? "claude-sonnet-4-20250514"
          : provider === "openai"
            ? "gpt-4o"
            : provider === "gemini"
              ? "gemini-2.0-flash"
              : ollamaConfig?.model || "llama2",
      host: ollamaConfig?.host,
      port: ollamaConfig?.port,
      system:
        "You are an API route analysis assistant. Analyze backend routes and provide structured metadata: authentication, body types, middleware, confidence. Always respond with valid JSON only — no markdown, no prose, just a JSON array.",
      message,
    });
    return content;
  }

  const response = await fetch("/api/proxy-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify({
      provider,
      apiKey,
      model:
        provider === "anthropic"
          ? "claude-sonnet-4-20250514"
          : provider === "openai"
            ? "gpt-4o"
            : provider === "gemini"
              ? "gemini-2.0-flash"
              : ollamaConfig?.model || "llama2",
      host: ollamaConfig?.host,
      port: ollamaConfig?.port,
      system:
        "You are an API route analysis assistant. Analyze backend routes and provide structured metadata: authentication, body types, middleware, confidence. Always respond with valid JSON only — no markdown, no prose, just a JSON array.",
      message,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erreur analyse IA");
  return data.content ?? "";
}
