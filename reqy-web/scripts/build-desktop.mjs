#!/usr/bin/env node
// Build wrapper for the Tauri desktop bundle.
//
// Responsibilities:
//   1. Set BUILD_TARGET=desktop so next.config.mjs enables `output: 'export'`
//      and skips `headers()`.
//   2. Exclude `app/api/workspaces` from the desktop build. These routes are
//      pure proxies to NEXT_PUBLIC_SYNC_URL; the desktop frontend calls
//      SYNC_URL directly (lib/workspace-api.ts). Next static export cannot run
//      API route handlers, and the `[id]` dynamic segments cannot be exported,
//      so the whole workspace API tree is moved aside during the build.
//   3. Patch each remaining `app/api/**/route.ts` so the `dynamic` export is a
//      string literal Next.js 16 can statically analyze (`force-dynamic` ->
//      `force-static`), then restore originals in `finally`.
//
// Copy-based exclusion (not rename) avoids EPERM that rename can hit when an
// IDE/antivirus holds a file lock inside the folder.

process.env.BUILD_TARGET = 'desktop'

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const apiDir = path.resolve('app/api')
const workspacesApiDir = path.resolve('app/api/workspaces')
const workspacesBackupDir = path.resolve('app/api/_workspaces.disabled')
const DYNAMIC_RE = /export const dynamic\s*=\s*['"]force-dynamic["'];?/
const DESKTOP_VALUE = "export const dynamic = 'force-static';"

function removeDirRobust(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

// Copy-based exclusion: duplicate the tree to a backup, then delete the source.
// Copy tolerates read locks; delete retries in case a transient lock remains.
function excludeWorkspaces() {
  if (!fs.existsSync(workspacesApiDir)) return false
  if (fs.existsSync(workspacesBackupDir)) removeDirRobust(workspacesBackupDir)
  fs.cpSync(workspacesApiDir, workspacesBackupDir, { recursive: true })
  removeDirRobust(workspacesApiDir)
  return true
}

function restoreWorkspaces() {
  if (!fs.existsSync(workspacesBackupDir)) return
  if (fs.existsSync(workspacesApiDir)) removeDirRobust(workspacesApiDir)
  fs.cpSync(workspacesBackupDir, workspacesApiDir, { recursive: true })
  removeDirRobust(workspacesBackupDir)
}

function findRouteFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      findRouteFiles(fullPath, results)
    } else if (entry.name === 'route.ts') {
      results.push(fullPath)
    }
  }
  return results
}

const workspacesExcluded = excludeWorkspaces()
if (workspacesExcluded) {
  console.log('[build-desktop] Excluded app/api/workspaces from desktop export (uses SYNC_URL directly)')
}

// Clean stale build artifacts AFTER excluding workspaces, so Next regenerates
// route type validators without the excluded tree (avoids stale "cannot find
// module" type errors from a prior build).
for (const dir of ['.next', 'out']) {
  if (fs.existsSync(dir)) {
    console.log(`[build-desktop] Cleaning ${dir}/`)
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch (err) {
      console.warn(`[build-desktop] Could not fully clean ${dir}/: ${err.message} — continuing anyway`)
    }
  }
}

const routeFiles = findRouteFiles(apiDir)
if (routeFiles.length === 0) {
  console.error('[build-desktop] No route.ts files found in app/api/')
  process.exit(1)
}

console.log(`[build-desktop] Patching ${routeFiles.length} route files (dynamic: force-dynamic → force-static)`)

// Snapshot originals so we can restore even if the build crashes.
const backups = new Map()
for (const file of routeFiles) {
  backups.set(file, fs.readFileSync(file, 'utf8'))
}

let buildStatus
try {
  for (const file of routeFiles) {
    const original = backups.get(file)
    if (!DYNAMIC_RE.test(original)) {
      console.warn(
        `[build-desktop] Skipping ${path.relative(process.cwd(), file)}: no force-dynamic export found.`,
      )
      continue
    }
    fs.writeFileSync(file, original.replace(DYNAMIC_RE, DESKTOP_VALUE))
  }

  console.log('[build-desktop] Running next build --webpack...')
  const result = spawnSync('next', ['build', '--webpack'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  buildStatus = result.status ?? 1
} finally {
  // Always restore source files to their original state.
  for (const [file, content] of backups) {
    fs.writeFileSync(file, content)
  }
  console.log('[build-desktop] Restored route files to original state')
  if (workspacesExcluded) {
    restoreWorkspaces()
    console.log('[build-desktop] Restored app/api/workspaces')
  }
}

process.exit(buildStatus ?? 1)
