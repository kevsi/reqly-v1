import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "@analyser/core";
import type { ApiRoute } from "@analyser/core";
import { detectorRust } from "../src/index.ts";

function compact(routes: ApiRoute[]) {
  return routes.map((r) => ({
    method: r.method,
    path: r.path,
    framework: r.framework,
    auth: r.auth.required,
    ...(r.auth.middleware?.length ? { middleware: r.auth.middleware } : {}),
    ...(r.body ? { body: r.body.schemaName ?? r.body.contentType ?? "body" } : {}),
    ...(r.params?.length ? { params: r.params } : {}),
    ...(r.query?.length ? { query: r.query } : {}),
  }));
}

const fixtures = ["axum", "actix"];

for (const name of fixtures) {
  test(`detector-rust: ${name}`, async () => {
    const rootPath = path.join(import.meta.dirname, "..", "fixtures", name);
    const result = await analyze({ rootPath, detectors: [detectorRust] });
    const expected = JSON.parse(await readFile(path.join(rootPath, "expected.json"), "utf8"));
    assert.deepEqual(compact(result.routes), expected);
  });
}
