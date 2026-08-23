/**
 * Unit tests for the analyser-api → SavedProject mapping
 * (lib/analyser-mapping.ts). Pure function, no Tauri/IO involved.
 */

import { describe, it, expect } from "vitest";
import { analysisResultToSavedProject, type AnalyserAnalysis } from "@/lib/analyser-mapping";

function sampleAnalysis(overrides: Partial<AnalyserAnalysis> = {}): AnalyserAnalysis {
  return {
    projectName: "demo-backend",
    rootPath: "/tmp/demo-backend",
    scannedAt: "2026-08-19T00:00:00.000Z",
    languagesDetected: ["python"],
    frameworksDetected: ["fastapi"],
    totalRoutes: 2,
    routesWithAuth: 1,
    routesWithoutAuth: 1,
    stats: {
      total: 2,
      withAuth: 1,
      withoutAuth: 1,
      confidence: { high: 1, medium: 1, low: 0 },
    },
    routes: [
      {
        id: "r1",
        method: "GET",
        path: "/api/v1/users",
        file: "/tmp/demo-backend/app/main.py",
        line: 12,
        framework: "fastapi",
        language: "python",
        auth: {
          required: true,
          type: "bearer",
          middleware: ["get_current_user"],
          confidence: "high",
        },
        body: { contentType: "application/json", raw: '{"name":"string"}' },
        handlerName: "list_users",
      },
      {
        id: "r2",
        method: "POST",
        path: "/api/v1/login",
        file: "/tmp/demo-backend/app/auth.py",
        line: 40,
        framework: "fastapi",
        language: "python",
        auth: { required: false, confidence: "low" },
        params: ["user_id"],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("analysisResultToSavedProject", () => {
  it("maps project metadata (name, framework, language, mode)", () => {
    const project = analysisResultToSavedProject(sampleAnalysis(), "static", "/tmp/demo-backend");
    expect(project.name).toBe("demo-backend");
    expect(project.framework).toBe("fastapi");
    expect(project.language).toBe("python");
    expect(project.folderPath).toBe("/tmp/demo-backend");
    expect(project.mode).toBe("static");
    expect(project.analyzedAt).toBe("2026-08-19T00:00:00.000Z");
    expect(project.id).toMatch(/^proj-/);
  });

  it("maps route auth (required + type + middleware) and body", () => {
    const project = analysisResultToSavedProject(sampleAnalysis(), "static", "/tmp/demo-backend");
    const [r1] = project.routes;
    expect(r1.method).toBe("GET");
    expect(r1.path).toBe("/api/v1/users");
    expect(r1.authRequired).toBe(true);
    expect(r1.authType).toBe("bearer");
    expect(r1.middlewareChain).toEqual(["get_current_user"]);
    expect(r1.bodyType).toBe("json");
    expect(r1.body).toBe('{"name":"string"}');
    expect(r1.sourceFile).toBe("/tmp/demo-backend/app/main.py");
    expect(r1.controller).toBe("list_users");
    expect(r1.confidence).toBe("HIGH");
  });

  it("maps unauthenticated route and falls back to custom auth type", () => {
    const analysis = sampleAnalysis();
    analysis.routes[1].auth.type = "verify_session_token";
    const project = analysisResultToSavedProject(analysis, "static", "/tmp/demo-backend");
    const [, r2] = project.routes;
    expect(r2.authRequired).toBe(false);
    expect(r2.authType).toBe("custom");
    expect(r2.bodyType).toBe("none");
    expect(r2.confidence).toBe("LOW");
  });

  it("handles ALL method and missing handler/body gracefully", () => {
    const analysis = sampleAnalysis({
      routes: [
        {
          id: "r3",
          method: "ALL",
          path: "/healthz",
          file: "/tmp/demo-backend/app/health.py",
          line: 2,
          framework: "fastapi",
          language: "python",
          auth: { required: false, confidence: "low" },
        },
      ],
    });
    const project = analysisResultToSavedProject(analysis, "ai", "/tmp/demo-backend");
    const [r] = project.routes;
    expect(r.method).toBe("GET");
    expect(r.name).toBe("ALL /healthz");
    expect(r.bodyType).toBe("none");
    expect(r.controller).toBeUndefined();
    expect(r.middlewareChain).toEqual([]);
    expect(project.mode).toBe("ai");
  });

  it("does not mutate input route objects", () => {
    const analysis = sampleAnalysis();
    analysisResultToSavedProject(analysis, "static", "/tmp/demo-backend");
    expect(analysis.routes[0].method).toBe("GET");
    expect(analysis.routes[0].auth.required).toBe(true);
  });
});
