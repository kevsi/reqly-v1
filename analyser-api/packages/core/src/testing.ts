import { readdirSync } from "node:fs";
import * as path from "node:path";
import type { ApiRoute } from "./types.ts";

export interface FixtureCase {
  /** Fixture directory basename, used in the test title. */
  name: string;
  /** Absolute path to the fixture project root. */
  rootPath: string;
}

/**
 * Lists fixture directories under `<testDir>/../fixtures`, sorted by name.
 * Each directory must contain an `expected.json`. Adding a fixture directory
 * is enough for it to be picked up by the detector tests.
 */
export function discoverFixtures(testDir: string): FixtureCase[] {
  const fixturesDir = path.join(testDir, "..", "fixtures");
  return readdirSync(fixturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, rootPath: path.join(fixturesDir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reduces routes to the compact shape used in fixtures' `expected.json`. */
export function compactRoutes(routes: ApiRoute[]): unknown[] {
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
