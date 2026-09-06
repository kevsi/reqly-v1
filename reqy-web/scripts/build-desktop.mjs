#!/usr/bin/env node
// Build wrapper for the Tauri desktop bundle.
//
// Responsibilities:
//   1. Set BUILD_TARGET=desktop so next.config.mjs enables `output: 'export'`
//      and skips `headers()`.
//   2. Exclude the whole `app/api` tree from the desktop build. The desktop
//      frontend calls SYNC_URL directly (lib/workspace-api.ts) or Tauri
//      commands (fetch_proxy) — it uses no Next route at all. Next static
//      export cannot run API route handlers, and the `[id]` dynamic segments
//      cannot be exported, so the whole API tree is moved aside (outside
//      reqy-web, see apiBackupDir below) during the build.// 3. Patch each remaining `app/api/**/route.ts` so the `dynamic` export is a
//      string literal Next.js 16 can statically analyze (`force-dynamic` ->
//      `force-static`), then restore originals in `finally`.
// 4. Build + deploy recli (dist + prod node_modules) into src-tauri/resources
//      so the packaged desktop app can spawn `node recli/dist/index.js serve`
//      (see src-tauri/src/mcp.rs resolve_script_path).
//
// Copy-based exclusion (not rename) avoids EPERM that rename can hit when an
// IDE/antivirus holds a file lock inside the folder.

process.env.BUILD_TARGET = "desktop";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const apiDir = path.resolve("app/api");
// La copie de secours vit HORS de reqy-web (racine du monorepo) : le tsconfig
// de reqy-web inclut "**/*.ts" relativement à son propre dossier, une copie
// sous app/ serait donc type-checkée pendant le build alors que ses imports
// "@/app/api/..." n'existent plus à cet emplacement (l'arbre est déplacé) —
// d'où des erreurs de type fantômes. Hors de reqy-web, elle est invisible
// pour tsc, Next et webpack.
const apiBackupDir = path.resolve("..", ".api-desktop-backup");
const DYNAMIC_RE = /export const dynamic\s*=\s*['"]force-dynamic["'];?/;
const DESKTOP_VALUE = "export const dynamic = 'force-static';";

function removeDirRobust(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Copy-based exclusion: duplicate the tree to a backup, then delete the source.
// Copy tolerates read locks; delete retries in case a transient lock remains.
// TOUT app/api est exclu (pas seulement workspaces) : le desktop n'appelle
// aucune route Next — les API sont des proxys serveur ; le client desktop
// passe par Tauri (fetch_proxy) ou SYNC_URL directement. Les routes à
// segments dynamiques ([id]) sont de toute façon incompatibles avec
// output:export.
function excludeApi() {
  if (!fs.existsSync(apiDir)) return false;
  if (fs.existsSync(apiBackupDir)) removeDirRobust(apiBackupDir);
  fs.cpSync(apiDir, apiBackupDir, { recursive: true });
  removeDirRobust(apiDir);
  return true;
}

function restoreApi() {
  if (!fs.existsSync(apiBackupDir)) return;
  if (fs.existsSync(apiDir)) removeDirRobust(apiDir);
  fs.cpSync(apiBackupDir, apiDir, { recursive: true });
  removeDirRobust(apiBackupDir);
}

function findRouteFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findRouteFiles(fullPath, results);
    } else if (entry.name === "route.ts") {
      results.push(fullPath);
    }
  }
  return results;
}

const apiExcluded = excludeApi();
if (apiExcluded) {
  console.log(
    "[build-desktop] Excluded app/api from desktop export (desktop: Tauri commands + SYNC_URL, no Next routes)",
  );
}

// Build + deploy recli (dist + prod node_modules) as a Tauri resource so the
// packaged app can spawn `node recli/dist/index.js serve` — see
// src-tauri/src/mcp.rs resolve_script_path. Best-effort: a network hiccup while
// resolving prod deps must not sink the whole desktop build, so on failure we
// warn and continue (the packaged app then simply has no MCP server).
// ponytail: `pnpm deploy` re-resolves prod deps (network) and can be slow;
// upgrade path is an offline bundle (esbuild single-file) if builds must be hermetic.
function deployRecliForDesktop() {
  const root = path.resolve("..");
  const target = path.resolve(root, "src-tauri", "resources", "recli");

  // recli tsc résout @reqly/shared via son dist/ — sur un checkout CI frais
  // le workspace n'est pas encore compilé, il faut builder shared d'abord.
  console.log("[build-desktop] Building @reqly/shared...");
  const shared = spawnSync("pnpm", ["--filter", "@reqly/shared", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (shared.status !== 0) {
    console.warn("[build-desktop] @reqly/shared build failed — recli échouera aussi");
  }

  console.log("[build-desktop] Building recli...");
  const build = spawnSync("pnpm", ["--dir", "recli", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (build.status !== 0) {
    console.warn("[build-desktop] recli build failed — packaged app will have no MCP server");
    return;
  }
  removeDirRobust(target);
  console.log("[build-desktop] Deploying recli (prod deps) into src-tauri/resources/recli...");
  const deploy = spawnSync("pnpm", ["--filter", "recli", "deploy", "--legacy", "--prod", target], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (deploy.status !== 0) {
    console.warn("[build-desktop] recli deploy failed — packaged app will have no MCP server");
  } else {
    console.log("[build-desktop] recli deployed to src-tauri/resources/recli");
  }
}

deployRecliForDesktop();

// Clean stale build artifacts AFTER excluding workspaces, so Next regenerates
// route type validators without the excluded tree (avoids stale "cannot find
// module" type errors from a prior build).
for (const dir of [".next", "out"]) {
  if (fs.existsSync(dir)) {
    console.log(`[build-desktop] Cleaning ${dir}/`);
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (err) {
      console.warn(
        `[build-desktop] Could not fully clean ${dir}/: ${err.message} — continuing anyway`,
      );
    }
  }
}

// The web build keeps the root layout dynamic for nonce propagation. Tauri is
// a static export, so patch that layout for this build and restore it in finally.
const layoutFile = path.resolve("app/layout.tsx");
const filesToPatch = fs.existsSync(layoutFile) ? [layoutFile] : [];
console.log(
  `[build-desktop] Patching ${filesToPatch.length} layout file(s) (dynamic: force-dynamic → force-static)`,
);

// Snapshot originals so we can restore even if the build crashes.
const backups = new Map();
for (const file of filesToPatch) {
  backups.set(file, fs.readFileSync(file, "utf8"));
}

let buildStatus;
try {
  for (const file of filesToPatch) {
    const original = backups.get(file);
    if (!DYNAMIC_RE.test(original)) {
      console.warn(
        `[build-desktop] Skipping ${path.relative(process.cwd(), file)}: no force-dynamic export found.`,
      );
      continue;
    }
    fs.writeFileSync(file, original.replace(DYNAMIC_RE, DESKTOP_VALUE));
  }

  console.log("[build-desktop] Running next build --webpack...");
  const result = spawnSync("next", ["build", "--webpack"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  buildStatus = result.status ?? 1;
} finally {
  // Always restore source files to their original state.
  for (const [file, content] of backups) {
    fs.writeFileSync(file, content);
  }
  console.log("[build-desktop] Restored layout files to original state");
  if (apiExcluded) {
    restoreApi();
    console.log("[build-desktop] Restored app/api");
  }
}

process.exit(buildStatus ?? 1);
