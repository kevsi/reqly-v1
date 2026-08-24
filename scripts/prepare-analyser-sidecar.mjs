//! Assembles `src-tauri/resources/analyser-api` (source + prod node_modules)
//! from the analyser-api workspace, mirroring the bundled `recli` resource.
//! Run as part of `tauri build` (`beforeBuildCommand`). Dev mode uses the
//! workspace checkout directly, so this is only needed for release builds.

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "analyser-api");
const dest = path.join(root, "src-tauri", "resources", "analyser-api");

const PACKAGES = ["core", "detector-js", "detector-rust", "detector-python", "detector-go", "cli"];

if (!existsSync(src)) {
  throw new Error(`analyser-api workspace not found at ${src}`);
}

// Windows: the dir may be briefly locked (pnpm store hardlinks, Defender),
// so retry before giving up.
await rm(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
await mkdir(dest, { recursive: true });

// Workspace config: fresh minimal file, not a copy of analyser-api's (its
// `onlyBuiltDependencies` placeholders are ignored by pnpm 11 and the lang
// build scripts would never run — `allowBuilds` with explicit booleans works).
await mkdir(path.join(dest, "packages"), { recursive: true });
await writeFile(
  path.join(dest, "pnpm-workspace.yaml"),
  [
    "packages:",
    '  - "packages/*"',
    "",
    "allowBuilds:",
    "  '@ast-grep/lang-go': true",
    "  '@ast-grep/lang-python': true",
    "  '@ast-grep/lang-rust': true",
    "",
  ].join("\n"),
);

// Root package.json — pnpm needs it as the workspace root manifest.
const rootPkg = path.join(src, "package.json");
if (existsSync(rootPkg)) await cp(rootPkg, path.join(dest, "package.json"));

for (const p of PACKAGES) {
  const srcPkg = path.join(src, "packages", p);
  const destPkg = path.join(dest, "packages", p);
  if (!existsSync(srcPkg)) continue;
  await mkdir(destPkg, { recursive: true });
  // Only the runtime surface: package.json (name/type/exports/deps for pnpm
  // resolution) + src. tsconfigs are build-time only and never run here.
  const pkgJson = path.join(srcPkg, "package.json");
  if (existsSync(pkgJson)) await cp(pkgJson, path.join(destPkg, "package.json"));
  await cp(path.join(srcPkg, "src"), path.join(destPkg, "src"), { recursive: true });
}

// Prod install — ast-grep napi + lang packages download prebuilt binaries
// (platform-specific; must run on the target build OS).
execSync("pnpm install --prod", { cwd: dest, stdio: "inherit" });

console.log(`analyser-api sidecar assembled at ${dest}`);
