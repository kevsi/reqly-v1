#!/usr/bin/env node
/**
 * Bundle size gate for CI.
 *
 * Parses the webpack-bundle-analyzer HTML report (`.next/analyze/client.html`,
 * emitted by `ANALYZE=true next build`) and sums the gzipped size of the
 * chunks that are initial for the `main-app` entrypoint — the app shell that
 * every page load downloads. Fails the build when that exceeds 500 KB.
 *
 * Exit codes: 0 = pass, 1 = fail (bundle too big or report unparseable).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPORT = resolve(dirname(fileURLToPath(import.meta.url)), "../.next/analyze/client.html");
const LIMIT_BYTES = 500 * 1024; // 500 KB gzipped

if (!existsSync(REPORT)) {
  console.error(`[bundle-gate] report not found: ${REPORT} (run ANALYZE=true next build first)`);
  process.exit(1);
}

const html = readFileSync(REPORT, "utf8");

// Top-level chunk objects look like:
//   {"label":"static/chunks/<id>.js","isAsset":true,"statSize":..,"parsedSize":..,"gzipSize":N
const CHUNK_RE =
  /"label":"(static\/chunks\/[^"]+\.js)","isAsset":true,"statSize":(\d+),"parsedSize":(\d+),"gzipSize":(\d+)/g;

const chunks = [];
let m;
while ((m = CHUNK_RE.exec(html)) !== null) {
  chunks.push({ label: m[1], gzip: Number(m[4]) });
}

if (chunks.length === 0) {
  console.error("[bundle-gate] no chunks parsed from report — analyzer format changed?");
  process.exit(1);
}

// Region of a chunk object: from its label up to the next top-level chunk.
function chunkRegion(label) {
  const start = html.indexOf(`"label":"${label}"`);
  if (start < 0) return "";
  const next = html.indexOf('"label":"static/chunks/', start + label.length);
  return html.slice(start, next > 0 ? next : start + 500000);
}

let total = 0;
for (const c of chunks) {
  // Non-empty isInitialByEntrypoint map containing the main-app entrypoint.
  if (chunkRegion(c.label).includes('"isInitialByEntrypoint":{"main-app"')) {
    total += c.gzip;
  }
}

if (total === 0) {
  console.error(
    "[bundle-gate] no chunks marked initial for main-app — entrypoint name changed?",
  );
  process.exit(1);
}

console.log(
  `[bundle-gate] main-app shell: ${(total / 1024).toFixed(1)} KB gzipped (${chunks.length} chunks analyzed)`,
);

if (total > LIMIT_BYTES) {
  console.error(
    `[bundle-gate] FAIL: ${(total / 1024).toFixed(1)} KB exceeds ${LIMIT_BYTES / 1024} KB limit`,
  );
  process.exit(1);
}

console.log("[bundle-gate] OK");
