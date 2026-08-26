import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "@analyser/core";
import { compactRoutes, discoverFixtures } from "@analyser/core/testing";
import { detectorPhp } from "../src/index.ts";

for (const { name, rootPath } of discoverFixtures(import.meta.dirname)) {
  test(`detector-php: ${name}`, async () => {
    const result = await analyze({ rootPath, detectors: [detectorPhp] });
    const expected = JSON.parse(await readFile(path.join(rootPath, "expected.json"), "utf8"));
    assert.deepEqual(compactRoutes(result.routes), expected);
  });
}
