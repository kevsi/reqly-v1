#!/usr/bin/env node
// Prepare the Next.js standalone output for deployment on a bare EC2 host.
//
// Problem: `next build` in a pnpm monorepo emits a standalone that is NOT
// self-contained. The traced `.pnpm` copy of `next` is partial (only the files
// the tracer followed), and `reqy-web/node_modules/next` is a symlink that
// escapes the standalone folder to the local pnpm store. Both break on the
// server: the escaping symlink gets dereferenced by scp into a real dir that
// has no sibling deps (pnpm keeps deps as siblings in `.pnpm/next@...`), so
// `@swc/helpers` etc. can't be resolved at runtime.
//
// Fix: flatten the standalone into a classic flat `node_modules` layout — real
// directories for `next` and its whole transitive dep closure, no symlinks,
// no `.pnpm` virtual store. Then `scp -r` works as-is.
//
// Usage:  node scripts/prepare-standalone.mjs   (from reqy-web/)
// Run AFTER `pnpm build`.

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const standalone = path.join(root, '.next', 'standalone')
const appDir = path.join(standalone, 'reqy-web')
const appNodeModules = path.join(appDir, 'node_modules')
const store = path.join(standalone, 'node_modules', '.pnpm')
const monorepoRoot = path.resolve(root, '..')
const monorepoStore = path.join(monorepoRoot, 'node_modules', '.pnpm')

function die(msg) {
  console.error(`[prepare-standalone] ERROR: ${msg}`)
  process.exit(1)
}

for (const p of [standalone, appDir]) {
  if (!fs.existsSync(p)) die(`missing ${p}`)
}

const storeExists = fs.existsSync(store)

// ---- 1. flatten store packages into a flat node_modules (idempotent) ----
// Only needed when the build just emitted a store; once flattened the store
// is gone and the flat layout stays. Skipping keeps re-runs safe.
if (storeExists) {
  // 1a. find the traced `next` store entry in the standalone
  const nextEntry = fs.readdirSync(store).find((d) => d.startsWith('next@'))
  if (!nextEntry) die('no next@ entry in standalone .pnpm store')

  const tracedNext = path.join(store, nextEntry, 'node_modules', 'next')
  const monorepoNext = path.join(monorepoStore, nextEntry, 'node_modules', 'next')
  if (!fs.existsSync(monorepoNext)) die(`monorepo store has no ${nextEntry}`)

  // 1b. replace the partial traced `next` with the full package
  console.log(`[1/4] replacing partial traced next (${nextEntry}) with full copy`)
  fs.rmSync(tracedNext, { recursive: true, force: true })
  fs.cpSync(monorepoNext, tracedNext, { recursive: true })

  // 1c. flatten every real package from the store into app node_modules
  // Every `<name>@<version>` store entry contains the real package at
  // `.pnpm/<entry>/node_modules/<name>` (scoped: `node_modules/@scope/name`).
  // Copy each real dir into the flat `reqy-web/node_modules`, replacing any
  // escaping symlinks. Scoped siblings (@img/colour, @img/sharp-*) merge into
  // the same `@scope` parent dir.
  console.log('[2/4] flattening store packages into reqy-web/node_modules')
  for (const entry of fs.readdirSync(store)) {
    const entryNm = path.join(store, entry, 'node_modules')
    if (!fs.existsSync(entryNm)) continue
    let relPath
    if (entry.startsWith('@')) {
      // @scope+name@version  ->  real package at @scope/name
      const rest = entry.slice(1).split('@') // ['scope+name', 'version']
      const [scopeAndName] = rest
      const at = scopeAndName.indexOf('+')
      const scope = scopeAndName.slice(0, at)
      const name = scopeAndName.slice(at + 1)
      relPath = `@${scope}/${name}`
    } else {
      const [name] = entry.split('@')
      relPath = name
    }
    const pkgDir = path.join(entryNm, ...relPath.split('/'))
    if (!fs.existsSync(pkgDir)) continue
    const dest = path.join(appNodeModules, ...relPath.split('/'))
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(pkgDir, dest, { recursive: true })
  }

  // 1d. remove the now-dead .pnpm virtual store
  console.log('[3/4] removing dead .pnpm virtual store')
  fs.rmSync(store, { recursive: true, force: true })
} else {
  console.log('[1/3] store already flattened, skipping')
}

// ---- 2. copy static assets + public into the standalone ----
// Next standalone only ships server.js + traced deps; the runtime serves
// /_next/static and /public from the app dir inside the standalone. Without
// these the app loads but every asset 404s.
console.log('[2/3] copying .next/static and public into standalone')
const appBuild = path.join(root, '.next')
const srcStatic = path.join(appBuild, 'static')
const srcPublic = path.join(root, 'public')
for (const [src, dest] of [
  [srcStatic, path.join(appDir, '.next', 'static')],
  [srcPublic, path.join(appDir, 'public')],
]) {
  if (!fs.existsSync(src)) die(`missing ${src}`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
}

// ---- 3. verify the flatten by loading next's server chain ----
console.log('[3/3] verifying next loads from flattened node_modules')
try {
  execSync(
    'node -e "require(\'./node_modules/next/dist/server/next.js\'); console.log(\'NEXT LOADS OK\')"',
    { cwd: path.join(standalone, 'reqy-web'), stdio: 'inherit' },
  )
} catch {
  die('next failed to load after flatten — see error above')
}

console.log('done. standalone is self-contained (flat node_modules, static, public, no store).')
console.log('Transfer hint: scp -r of .next/standalone now works; no tar/symlink gymnastics needed.')
