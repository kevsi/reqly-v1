import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitignore, isGitignoreMatch } from "../src/scanner.ts";
import { diffRoutes } from "../src/helpers.ts";
import { toOpenApi } from "../src/formatters/openapi.ts";
import type { AnalysisResult, ApiRoute } from "../src/types.ts";

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
  };
  const result = {
    projectName: "demo",
    routes: [route],
  } as unknown as AnalysisResult;
  const spec = toOpenApi(result) as {
    paths: Record<string, Record<string, any>>;
  };
  const op = spec.paths["/users/{id}"]!.post!;
  assert.equal(op.security?.[0]?.auth.length, 0);
  assert.equal(op.parameters[0]!.name, "id");
  assert.equal(op.parameters[0]!.in, "path");
  assert.ok(op.requestBody.content["application/json"].schema.title === "CreateUserDto");
});
