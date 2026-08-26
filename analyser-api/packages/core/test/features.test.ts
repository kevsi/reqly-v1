import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/orchestrator.ts";
import { collectSourceFiles, parseGitignore, isGitignoreMatch } from "../src/scanner.ts";
import { diffRoutes } from "../src/helpers.ts";
import { toOpenApi } from "../src/formatters/openapi.ts";
import { toReqly } from "../src/formatters/reqly.ts";
import type { AnalysisResult, ApiRoute, Detector } from "../src/types.ts";

test("parseGitignore drops comments, negation and blanks", () => {
  const out = parseGitignore(
    ["node_modules", "/tmp", "build/", "!keep.txt", "# comment", "", "dist"].join("\n"),
  );
  assert.deepEqual(out, ["node_modules", "/tmp", "build", "dist"]);
});

test("isGitignoreMatch basename, rooted and nested patterns", () => {
  assert.equal(isGitignoreMatch("node_modules", "a/node_modules", ["node_modules"]), true);
  assert.equal(isGitignoreMatch("src", "src", ["/src"]), true);
  assert.equal(isGitignoreMatch("src", "a/src", ["/src"]), false);
  assert.equal(isGitignoreMatch("gen", "pkg/gen", ["pkg/gen"]), true);
  assert.equal(isGitignoreMatch("gen", "pkg/gen/x.go", ["pkg/gen"]), true);
  assert.equal(isGitignoreMatch("keep", "keep.txt", ["!keep.txt"]), false);
});

test("diffRoutes detects added, removed and changed", () => {
  const a = {
    id: "x",
    method: "GET" as const,
    path: "/users",
    file: "a.ts",
    line: 1,
    framework: "express",
    language: "javascript",
    auth: { required: false, confidence: "low" as const },
  };
  const b = { ...a, auth: { required: true, confidence: "high" as const } };
  const c = { ...a, path: "/health" };
  const d = { ...a, path: "/gone" };
  const diff = diffRoutes([a, d], [b, c]);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0]!.path, "/health");
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0]!.path, "/gone");
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0]!.path, "/users");
});

test("toOpenApi maps routes to paths with params, body and security", () => {
  const route: ApiRoute = {
    id: "x",
    method: "POST",
    path: "/users/:id",
    file: "a.ts",
    line: 1,
    framework: "express",
    language: "javascript",
    auth: { required: true, middleware: ["auth"], confidence: "high" },
    body: { contentType: "application/json", schemaName: "CreateUserDto" },
    params: ["id"],
    query: ["page"],
  };
  const result = {
    projectName: "demo",
    routes: [route],
  } as unknown as AnalysisResult;
  const spec = toOpenApi(result) as {
    paths: Record<string, Record<string, any>>;
    components?: { securitySchemes?: Record<string, { type: string; scheme: string }> };
  };
  const op = spec.paths["/users/{id}"]!.post!;
  assert.equal(op.security?.[0]?.auth.length, 0);
  assert.equal(op.parameters[0]!.name, "id");
  assert.equal(op.parameters[0]!.in, "path");
  const queryParams = op.parameters.filter((p: any) => p.in === "query") as Array<{ name: string }>;
  assert.equal(queryParams.length, 1);
  assert.equal(queryParams[0]!.name, "page");
  const scheme = spec.components?.securitySchemes?.auth;
  assert.ok(scheme);
  assert.equal(scheme.type, "http");
  assert.equal(scheme.scheme, "bearer");
  assert.ok(op.requestBody.content["application/json"].schema.title === "CreateUserDto");
});

test("file-structure fallback derives routes with real line numbers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyser-fallback-"));
  try {
    await fs.mkdir(path.join(dir, "ping"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "ping", "lister.js"),
      '// ping handler\n\nexport const handler = () => "pong";\n',
      "utf8",
    );
    const stub: Detector = {
      name: "stub",
      language: "javascript",
      frameworks: [],
      extensions: [".js"],
      canHandle: () => true,
      rules: [],
      assemble: () => [],
    };
    const result = await analyze({ rootPath: dir, detectors: [stub] });
    const route = result.routes[0];
    assert.ok(route);
    assert.equal(route.method, "GET");
    assert.equal(route.path, "/ping");
    assert.equal(route.framework, "custom");
    // First non-comment, non-empty source line (not always 1).
    assert.equal(route.line, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("collectSourceFiles respects gitignore", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyser-gitignore-"));
  try {
    await fs.writeFile(path.join(dir, ".gitignore"), "ignored.js\n", "utf8");
    await fs.writeFile(path.join(dir, "kept.js"), "const x=1;", "utf8");
    await fs.writeFile(path.join(dir, "ignored.js"), "const y=1;", "utf8");
    const files = await collectSourceFiles(dir, [".js"], [], ["ignored.js"]);
    assert.ok(files.some((f) => f.endsWith("kept.js")));
    assert.ok(!files.some((f) => f.endsWith("ignored.js")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyze respects langs filter", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyser-langs-"));
  try {
    await fs.writeFile(path.join(dir, "package.json"), '{"name":"x"}', "utf8");
    await fs.writeFile(path.join(dir, "app.js"), 'app.get("/a", handler)', "utf8");
    const jsDetector: Detector = {
      name: "js",
      language: "javascript",
      frameworks: ["express"],
      extensions: [".js"],
      canHandle: () => true,
      rules: [{ id: "route-call", pattern: "$APP.$METHOD($PATH, $HANDLER)", kind: "call_expression" }],
      assemble: (matches) =>
        matches.map((m) => ({
          id: "1",
          method: "GET",
          path: "/a",
          file: m.file,
          line: 1,
          framework: "express",
          language: "javascript",
          auth: { required: false, confidence: "low" },
        })),
    };
    const goDetector: Detector = {
      name: "go",
      language: "go",
      frameworks: ["gin"],
      extensions: [".go"],
      canHandle: () => false,
      rules: [],
      assemble: () => [],
    };
    const all = await analyze({ rootPath: dir, detectors: [jsDetector, goDetector] });
    assert.ok(all.languagesDetected.includes("javascript"));
    const filtered = await analyze({ rootPath: dir, detectors: [jsDetector, goDetector], langs: ["go"] });
    assert.equal(filtered.routes.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("toReqly is deterministic regardless of input order", () => {
  const routes: ApiRoute[] = [
    {
      id: "2",
      method: "POST",
      path: "/users",
      file: "b.ts",
      line: 1,
      framework: "express",
      language: "javascript",
      auth: { required: false, confidence: "low" },
    },
    {
      id: "1",
      method: "GET",
      path: "/health",
      file: "a.ts",
      line: 1,
      framework: "express",
      language: "javascript",
      auth: { required: false, confidence: "low" },
    },
  ];
  const result = { projectName: "demo", routes } as unknown as AnalysisResult;
  const reqly1 = toReqly(result);
  const reqly2 = toReqly({ projectName: "demo", routes: [...routes].reverse() } as unknown as AnalysisResult);
  assert.deepEqual(reqly1, reqly2);
  assert.equal(reqly1.requests[0]!.url, "{{baseUrl}}/health");
  assert.equal(reqly1.requests[1]!.url, "{{baseUrl}}/users");
});
