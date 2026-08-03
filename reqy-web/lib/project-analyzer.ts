"use client"

import path from "path"
import type { AIProvider, SavedProject, AnalysisMode } from "@/lib/types"
import { loadOllamaConfig } from "@/lib/config"
import { proxyAuthHeaders } from "@/lib/proxy-auth"
import { isTauriAvailable } from "@/lib/tauri"
import { callAiProxyTauri } from "@/lib/tauri-ai"
import { readDir, readTextFile } from "@tauri-apps/plugin-fs"
import {
  type DetectedRoute,
  type HttpMethod,
  detectLanguage,
  detectFramework,
  detectRoutes,
  detectPort,
  defaultPortForFramework,
  matchFramework,
  makeRoute,
  normalizePath,
  isNonRouteFile,
  isRelevantFile,
  stripLanguageCommentsAndStrings,
  escapeRegExpStr,
  scanFrontendApiCalls,
  correlateWithFrontendCall,
  detectNextjsAppRouter,
  detectNextjsPagesRouter,
  analyzeHandlerBody,
  detectAuthInArgs,
  detectBodyTypeInArgs,
  detectAuthByStatusSignal,
  inferAuthFromPathAndName,
  parseMethodList,
  IGNORED_FOLDERS,
  FRAMEWORK_FILE_EXTENSIONS,
  detectExpress,
  detectFastify,
  detectKoa,
  detectHapi,
  detectKtor,
  detectFastAPI,
  detectFlask,
  detectDjango,
  detectTornado,
  detectSanic,
  detectStarlette,
  detectLitestar,
  detectAiohttp,
  detectFalcon,
  detectNestJS,
  detectLaravel,
  detectRails,
  detectPhoenix,
  detectServant,
  detectSpring,
  detectMicronaut,
  detectQuarkus,
  detectAspNet,
  detectGo,
} from "./detect-shared"

declare const require: any

const MAX_FILES = 200

// ── Public API ───────────────────────────────────────────────────────────

export async function analyzeProject(
  folderPath: string,
  mode: AnalysisMode,
  provider?: AIProvider,
  apiKey?: string,
): Promise<SavedProject> {
  if (mode === "ai") {
    if (provider !== "ollama" && !apiKey) throw new Error("Clé API requise pour l'analyse IA")
    return analyzeWithAI(folderPath, provider ?? "openai", apiKey)
  }
  return analyzeStatic(folderPath)
}

// ── Static analysis ──────────────────────────────────────────────────────

async function analyzeStatic(folderPath: string): Promise<SavedProject> {
  const filePaths = await getFiles(folderPath)
  const files: { path: string; content: string }[] = []
  const routes: DetectedRoute[] = []

  for (const fp of filePaths) {
    try {
      const content = await readTextFile(fp)
      files.push({ path: fp, content })
    } catch { /* skip unreadable file */ }
  }

  const filteredFiles = files.filter((f) => !isNonRouteFile(f.path))

  // ── Project-level auth indicators ────────────────────────────────────
  const projectAuthIndicators = {
    hasPassport: false,
    hasJsonWebToken: false,
    hasCookieAccess: false,
    hasSession: false,
    hasNextAuth: false,
    hasClerk: false,
    hasSupabaseAuth: false,
    hasFirebaseAuth: false,
  }
  for (const f of files) {
    const c = f.content
    if (/\bpassport\b/.test(c)) projectAuthIndicators.hasPassport = true
    if (/\bjsonwebtoken\b|\bjwt\.verify\b|\bjwt\.sign\b/.test(c)) projectAuthIndicators.hasJsonWebToken = true
    if (/request\.cookies|NextResponse\.cookie|response\.cookies|cookies\.get\(|cookies\.set\(/.test(c)) projectAuthIndicators.hasCookieAccess = true
    if (/\.session\b|req\.session|session\[|express-session/.test(c)) projectAuthIndicators.hasSession = true
    if (/next-auth|NextAuth|getServerSession|getSession|useSession/.test(c)) projectAuthIndicators.hasNextAuth = true
    if (/@clerk\/|useAuth\(\)|currentUser\(\)|auth\(\)/.test(c)) projectAuthIndicators.hasClerk = true
    if (/supabase.*auth|createClient.*supabase/.test(c)) projectAuthIndicators.hasSupabaseAuth = true
    if (/firebase\/auth|signInWith|onAuthStateChanged/.test(c)) projectAuthIndicators.hasFirebaseAuth = true
  }

  const language = detectLanguage(filteredFiles)
  const framework = detectFramework(filteredFiles)
  const relevantFiles = filteredFiles.filter(
    (f) => isRelevantFile(f.path, framework)
  )

  // ── Prefix map for FastAPI include_router ────────────────────────────
  const prefixMap: Record<string, string> = {}
  const INCLUDE_ROUTER_RE = /include_router\s*\(\s*([A-Za-z0-9_.]+)\s*,\s*prefix\s*[:=]\s*['"]([^'"]+)['"]/g
  const APIRouter_RE = /([A-Za-z_][\w]*)\s*=\s*APIRouter\s*\(\s*[^\)]*prefix\s*[:=]\s*['"]([^'"]+)['"][^\)]*\)/g
  for (const f of relevantFiles) {
    let m
    INCLUDE_ROUTER_RE.lastIndex = 0
    while ((m = INCLUDE_ROUTER_RE.exec(f.content)) !== null) {
      const ident = (m[1] || "").split('.')[0]
      const pref = m[2] || ""
      if (ident && pref) prefixMap[ident] = pref
    }
    APIRouter_RE.lastIndex = 0
    while ((m = APIRouter_RE.exec(f.content)) !== null) {
      const ident = m[1]
      const pref = m[2] || ""
      if (ident && pref) prefixMap[ident] = pref
    }
  }

  // ── NestJS Controller prefix map ──────────────────────────────────────
  const nestjsControllerPrefixByFile: Record<string, string> = {}
  for (const f of relevantFiles) {
    const m = f.content.match(/@Controller\s*\(\s*['"`]([^'"`]*)['"` `]/)
    if (m) nestjsControllerPrefixByFile[f.path] = normalizePath(m[1])
  }

  // ── Import & local def resolution ────────────────────────────────────
  const importsByFile: Record<string, Record<string, ImportInfo>> = {}
  const localDefinitionsByFile: Record<string, Set<string>> = {}
  for (const f of relevantFiles) {
    importsByFile[f.path] = parseImports(f.content)
    localDefinitionsByFile[f.path] = parseLocalDefinitions(f.content)
  }

  // ── app.use / router.use mount detection ─────────────────────────────
  const routerMounts: Record<string, { prefix?: string; middlewares: string[] }> = {}
  const pathMiddlewares: Record<string, string[]> = {}
  const appMiddlewares: string[] = []

  for (const f of relevantFiles) {
    parseAppUse(f.content, f.path, importsByFile, localDefinitionsByFile, routerMounts, pathMiddlewares, appMiddlewares)
  }

  // ── Detect routes per file ────────────────────────────────────────────
  const seen = new Set<string>()

  for (const f of relevantFiles) {
    const nestPrefix = nestjsControllerPrefixByFile[f.path]
    const detected = await detectRoutes(f.content, f.path, framework)

    for (const r of detected) {
      if (nestPrefix) {
        r.path = normalizePath(`${nestPrefix}/${r.path}`)
      }
      const fastapiPrefix = r.controller && prefixMap[r.controller as string]
      if (fastapiPrefix) {
        r.path = normalizePath(`${fastapiPrefix}/${r.path}`)
      }

      const key = `${r.method}|${r.path}`
      if (seen.has(key)) continue
      seen.add(key)
      r.sourceFile = f.path
      routes.push(r)
    }
  }

  // ── Next.js App Router (app/api/**/route.*) ───────────────────────────
  for (const f of relevantFiles) {
    const detected = detectNextjsAppRouter(f)
    for (const r of detected) {
      const key = `${r.method}|${r.path}`
      if (seen.has(key)) continue
      seen.add(key)
      routes.push(r)
    }
  }

  // ── Next.js Pages Router (pages/api/**) ──────────────────────────────
  for (const f of relevantFiles) {
    const detected = detectNextjsPagesRouter(f)
    for (const r of detected) {
      const key = `${r.method}|${r.path}`
      if (seen.has(key)) continue
      seen.add(key)
      routes.push(r)
    }
  }

  // ── Strengthen auth via import resolution ─────────────────────────────
  for (const r of routes) {
    if (r.authRequired) continue
    const fp = r.sourceFile
    if (!fp) continue
    const candidates = [
      ...(r.middlewareChain || []),
      typeof r.controller === "string" ? r.controller : undefined,
    ].filter(Boolean) as string[]

    if (candidates.some((id) => isAuthMiddleware(id, fp, importsByFile, localDefinitionsByFile))) {
      r.authRequired = true
      r.authType = r.authType || "middleware"
      r.reasonings?.push("Auth helper détecté via import/définition locale")
    }

    if (!r.authRequired && fp) {
      const content = filteredFiles.find((ff) => ff.path === fp)?.content || ""
      if (projectAuthIndicators.hasNextAuth && /getServerSession|getSession|auth\(\)/.test(content)) {
        r.authRequired = true; r.authType = "cookie"; r.reasonings?.push("NextAuth getServerSession dans le handler")
      }
      if (projectAuthIndicators.hasClerk && /currentUser\(\)|auth\(\)|clerkClient/.test(content)) {
        r.authRequired = true; r.authType = "middleware"; r.reasonings?.push("Clerk auth dans le handler")
      }
      if (projectAuthIndicators.hasSupabaseAuth && /supabase\.auth\.getUser|supabase\.auth\.getSession/.test(content)) {
        r.authRequired = true; r.authType = "cookie"; r.reasonings?.push("Supabase auth dans le handler")
      }
    }
  }

  // ── Propagate mounts/middlewares to routes ────────────────────────────
  for (const r of routes) {
    try {
      const ctrl = (r.controller || "") as string
      if (ctrl && routerMounts[ctrl]) {
        const mount = routerMounts[ctrl]
        if (mount.prefix) r.path = normalizePath(`${mount.prefix}/${r.path}`)
        if (mount.middlewares?.length) {
          r.middlewareChain = [...mount.middlewares, ...(r.middlewareChain || [])]
          if (mount.middlewares.some((m) => isAuthLikeName(m))) {
            r.authRequired = true; r.authType = r.authType || "middleware"; r.reasonings?.push("Auth middleware hérité du mount router")
          }
        }
      }

      for (const pfx of Object.keys(pathMiddlewares)) {
        if (r.path.startsWith(pfx)) {
          r.middlewareChain = [...(pathMiddlewares[pfx] || []), ...(r.middlewareChain || [])]
          if ((pathMiddlewares[pfx] || []).some((m) => isAuthLikeName(m))) {
            r.authRequired = true; r.authType = r.authType || "middleware"; r.reasonings?.push(`Auth middleware hérité du path ${pfx}`)
          }
        }
      }

      if (appMiddlewares.length) {
        r.middlewareChain = [...appMiddlewares, ...(r.middlewareChain || [])]
        if (appMiddlewares.some((m) => isAuthLikeName(m))) {
          r.authRequired = true; r.authType = r.authType || "middleware"; r.reasonings?.push("Auth middleware global (app.use)")
        }
      }
    } catch {}
  }

  // ── Frontend API call scanning ────────────────────────────────────────
  const calledPaths = scanFrontendApiCalls(filteredFiles)
  const fileContentByPath: Record<string, string> = Object.fromEntries(
    relevantFiles.map((f) => [f.path, f.content])
  )

  // ── Final confidence + frontend usage correlation ─────────────────────
  for (const r of routes) {
    const content = fileContentByPath[r.sourceFile] || ""

    if (!r.authRequired) {
      const inference = inferAuthFromPathAndName(r.path, r.name)
      if (inference.required) {
        r.authRequired = true
        const allowed = ["none","bearer","basic","oauth","api-key","jwt","session","custom","middleware","cookie","passport"] as DetectedRoute['authType'][]
        r.authType = (inference.type && allowed.includes(inference.type)) ? inference.type : "middleware"
        r.reasonings?.push(`Route patterns indiquent une protection: ${r.path}`)
      }
    }

    if (!r.authRequired) {
      try {
        const escapedPath = escapeRegExpStr(r.path)
        const pat = new RegExp(`([A-Za-z_$][\\w$]*)\\.${r.method.toLowerCase()}\\s*\\(\\s*['"\`]${escapedPath}['"\`]\\s*,([\\s\\S]{0,2000}?)\\)`, "i")
        const mm = content.match(pat)
        if (mm) {
          const rawArgs = mm[2] || ""; const rawLower = rawArgs.toLowerCase()
          if (/passport\.authenticate|ensureauth|requireauth|verifyjwt|verifytoken|authenticatejwt|authguard|checkauth|isauth\b|auth\s*\(|login_required|permission_required|userrequired|adminonly|rolesrequired/.test(rawLower) ||
              /\b401\b|\b403\b|Unauthorized|Forbidden|NotAuthenticated|NotAuthorized/.test(rawArgs)) {
            r.authRequired = true; r.authType = r.authType || "middleware"; r.reasonings?.push("Auth détecté dans la déclaration inline")
          }
        }
      } catch {}
    }

    for (const called of calledPaths) {
      if (correlateWithFrontendCall(r.path, called)) {
        r.actuallyUsedByFrontend = true; r.reasonings?.push(`Référencé par appel frontend: ${called}`); break
      }
    }

    let score = 0
    if (r.authRequired) score += 3
    if (r.actuallyUsedByFrontend) score += 2
    if (r.bodyType && r.bodyType !== "none") score += 1
    if ((r.middlewareChain || []).length > 0) score += 1
    if ((r.reasonings || []).length > 1) score += 1
    r.confidence = score >= 5 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW"
  }

  return {
    id: `proj-${Date.now()}`,
    name: deriveName(folderPath),
    framework,
    language,
    folderPath,
    port: detectPort(files) ?? defaultPortForFramework(framework),
    routes,
    analyzedAt: new Date().toISOString(),
    mode: "static",
  }
}

// ── Recursive file walker (Tauri-dependent) ────────────────────────────────

async function getFiles(folderPath: string, depth = 0): Promise<string[]> {
  if (depth > 8) return []
  const results: string[] = []
  try {
    const entries = await readDir(folderPath)
    for (const entry of entries) {
      if (results.length >= MAX_FILES) break
      if (shouldSkip(entry.name)) continue
      if (entry.isDirectory) {
        results.push(...(await getFiles(`${folderPath}/${entry.name}`, depth + 1)))
      } else if (entry.isFile) {
        results.push(`${folderPath}/${entry.name}`)
      }
      if (results.length >= MAX_FILES) break
    }
  } catch (err) {
    if (depth === 0) throw err
  }
  return results
}

function shouldSkip(name: string): boolean {
  if (name.startsWith(".")) return true
  return IGNORED_FOLDERS.includes(name.toLowerCase())
}

function deriveName(folderPath: string): string {
  return folderPath.split(/[/\\]/).filter(Boolean).pop() ?? "Projet"
}

// ── Import & definition parsing ──────────────────────────────────────────

type ImportInfo = {
  importedName: string
  source: string
  isNamespace: boolean
  isDefault: boolean
}

function parseImports(content: string): Record<string, ImportInfo> {
  const imports: Record<string, ImportInfo> = {}

  for (const m of content.matchAll(/import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const specifier = m[1].trim(); const source = m[2].trim()
    if (specifier.startsWith("{")) {
      for (const named of specifier.slice(1, -1).split(",")) {
        const [orig, alias] = named.split(" as ").map((s) => s.trim())
        if (orig) imports[alias || orig] = { importedName: orig, source, isNamespace: false, isDefault: false }
      }
    } else if (specifier.startsWith("* as ")) {
      const alias = specifier.replace("* as ", "").trim()
      imports[alias] = { importedName: "*", source, isNamespace: true, isDefault: false }
    } else {
      imports[specifier] = { importedName: "default", source, isNamespace: false, isDefault: true }
    }
  }

  for (const m of content.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    imports[m[1]] = { importedName: "*", source: m[2], isNamespace: true, isDefault: true }
  }
  for (const m of content.matchAll(/const\s*\{\s*([^}]+)\s*\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const source = m[2].trim()
    for (const named of m[1].split(",")) {
      const [orig, alias] = named.split(" as ").map((s) => s.trim())
      if (orig) imports[alias || orig] = { importedName: orig, source, isNamespace: false, isDefault: false }
    }
  }
  return imports
}

function parseLocalDefinitions(content: string): Set<string> {
  const defs = new Set<string>()
  for (const m of content.matchAll(/(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defs.add(m[1])
  for (const m of content.matchAll(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*)/g)) defs.add(m[1])
  return defs
}

// ── Auth detection helpers ────────────────────────────────────────────────

const AUTH_IDENTIFIER_RE = /\b(?:auth|passport|jwt|session|verify|authenticate|ensureauth|requireauth|isauthenticated|oauth|token|github_token|access_token|api_key|bearer|authorization|withauth|protect|guard|secured|getserversession|currentuser|clerkauth|supabaseauth|login|signin|validatetoken|checkauth|authguard|authmiddleware|permissionguard|rolecheck|verifyjwt)\b/i

function isAuthLikeName(s: string): boolean {
  return AUTH_IDENTIFIER_RE.test(s)
}

function isAuthIdentifier(identifier: string): boolean {
  return AUTH_IDENTIFIER_RE.test(identifier)
}

function isImportAuth(
  identifier: string,
  filePath: string,
  importsByFile: Record<string, Record<string, ImportInfo>>
): boolean {
  const info = importsByFile[filePath]?.[identifier]
  if (!info) return false
  return /(?:passport|jsonwebtoken|jwt|next-auth|nextauth|auth|oauth|token|jose|argon2|bcrypt|crypto|clerk|supabase|firebase|auth0|okta|cognito|oidc)/i.test(info.source)
}

function isAuthMiddleware(
  token: string,
  filePath: string,
  importsByFile: Record<string, Record<string, ImportInfo>>,
  localDefinitionsByFile: Record<string, Set<string>>
): boolean {
  if (isAuthIdentifier(token)) return true
  if (isImportAuth(token, filePath, importsByFile)) return true
  if (localDefinitionsByFile[filePath]?.has(token) && isAuthIdentifier(token)) return true
  return false
}

// ── Argument splitter ─────────────────────────────────────────────────────

function splitTopLevelArgs(s: string): string[] {
  const parts: string[] = []
  let cur = ""; let depth = 0; let inQuote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuote) { cur += ch; if (ch === inQuote && s[i - 1] !== "\\") inQuote = null; continue }
    if (ch === '"' || ch === "'" || ch === "`") { inQuote = ch; cur += ch; continue }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; cur += ch; continue }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; cur += ch; continue }
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

// ── app.use / router.use parsing ─────────────────────────────────────────

function parseAppUse(
  content: string,
  filePath: string,
  importsByFile: Record<string, Record<string, ImportInfo>>,
  localDefinitionsByFile: Record<string, Set<string>>,
  routerMounts: Record<string, { prefix?: string; middlewares: string[] }>,
  pathMiddlewares: Record<string, string[]>,
  appMiddlewares: string[]
): void {
  const USE_RE = /([A-Za-z_$][\w$]*)\.use\s*\(\s*([\s\S]*?)\)/g
  for (const m of content.matchAll(USE_RE)) {
    const callee = m[1]; const inner = m[2]; const args = splitTopLevelArgs(inner)
    if (args.length === 0) continue
    const first = args[0]
    let pathArg: string | undefined; let rest = args.slice(1)
    if (/^['"`]/.test(first)) { pathArg = first.replace(/^['"`]|['"`]$/g, "") } else { rest = args }
    for (const token of rest) {
      const id = token.split(/[\s(.[]/)[0]
      if (!id) continue; const isAuth = isAuthMiddleware(id, filePath, importsByFile, localDefinitionsByFile)
      if (callee === "app") {
        if (pathArg) {
          if (!pathMiddlewares[pathArg]) pathMiddlewares[pathArg] = []
          if (!pathMiddlewares[pathArg].includes(id)) pathMiddlewares[pathArg].push(id)
          if (/^[A-Za-z_$][\w$]*$/.test(id)) { routerMounts[id] = routerMounts[id] || { middlewares: [] }; routerMounts[id].prefix = pathArg }
        } else {
          if (/^[A-Za-z_$][\w$]*$/.test(id) && !appMiddlewares.includes(id)) appMiddlewares.push(id)
        }
      } else {
        routerMounts[callee] = routerMounts[callee] || { middlewares: [] }
        if (!routerMounts[callee].middlewares.includes(id)) routerMounts[callee].middlewares.push(id)
        if (pathArg) routerMounts[callee].prefix = routerMounts[callee].prefix || pathArg
      }
    }
  }
}

// ── AI analysis ────────────────────────────────────────────────────────────

export async function analyzeWithAI(
  folderPath: string,
  provider: AIProvider,
  apiKey?: string,
): Promise<SavedProject> {
  const staticProject = await analyzeStatic(folderPath)
  const filePaths = await getFiles(folderPath)
  const files: { path: string; content: string }[] = []
  for (const fp of filePaths) {
    try { const content = await readTextFile(fp); files.push({ path: fp, content }) } catch {}
  }

  const aiRoutes = await enrichRoutesWithAI(staticProject.routes, provider, apiKey, files)

  return {
    ...staticProject,
    routes: aiRoutes,
    language: staticProject.language,
    mode: "ai",
    analyzedAt: new Date().toISOString(),
  }
}

async function enrichRoutesWithAI(
  routes: DetectedRoute[],
  provider: AIProvider,
  apiKey?: string,
  files: { path: string; content: string }[] = [],
): Promise<DetectedRoute[]> {
  if (routes.length === 0) return routes
  if (provider !== "ollama" && !apiKey) return routes

  function extractSnippet(route: DetectedRoute, maxChars = 2000): string {
    try {
      const file = files.find((f) => f.path === route.sourceFile)
      if (!file) return ""
      const content = file.content
      const pathRegex = route.path.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/")
      const idx = content.search(new RegExp(pathRegex))
      if (idx >= 0) {
        const start = Math.max(0, idx - 600); const end = Math.min(content.length, idx + 1000)
        return content.slice(start, end).substring(0, maxChars)
      }
      return content.slice(0, Math.min(content.length, maxChars))
    } catch { return "" }
  }

  const routeEntries = routes.map((r) => ({
    method: r.method, path: r.path, sourceFile: r.sourceFile, authRequired: r.authRequired,
    authType: r.authType, confidence: r.confidence, snippet: extractSnippet(r),
  }))

  const message = `You are an API route analysis assistant. Analyze each route below and return ONLY a valid JSON array where each object has:
{
  "method": "GET|POST|PUT|DELETE|PATCH",
  "path": "/api/route/path",
  "description": "brief description",
  "authRequired": boolean,
  "authType": "cookie" | "jwt" | "passport" | "middleware" | null,
  "bodyType": "json" | "form" | "none",
  "middlewareChain": ["middleware1"],
  "controller": "controller_name" | null,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasonings": ["reason1"]
}

Routes:
${routeEntries.map((e) => `Method: ${e.method}, Path: ${e.path}, Source: ${e.sourceFile}, Current Auth: ${e.authRequired ? e.authType || "unknown" : "none"}\nSnippet:\n${e.snippet}`).join("\n---\n")}`

  try {
    const content = await queryAI(provider, apiKey, message)
    const parsed = parseJsonResponse(content)
    if (!Array.isArray(parsed)) return routes

    const routeMap = new Map(parsed.map((item: any) => [`${item.method}|${item.path}`, item]))
    return routes.map((route) => {
      const match = routeMap.get(`${route.method}|${route.path}`)
      if (!match) return route
      return {
        ...route,
        description: typeof match.description === "string" ? match.description : route.description,
        authRequired: typeof match.authRequired === "boolean" ? match.authRequired : route.authRequired,
        bodyType: match.bodyType === "json" || match.bodyType === "form" ? match.bodyType : route.bodyType,
        middlewareChain: Array.isArray(match.middlewareChain) ? match.middlewareChain : route.middlewareChain,
        controller: typeof match.controller === "string" ? match.controller : route.controller,
        authType: typeof match.authType === "string" ? match.authType : route.authType,
        confidence: match.confidence || route.confidence,
        reasonings: Array.isArray(match.reasonings) ? [...(route.reasonings || []), ...match.reasonings] : route.reasonings,
      }
    })
  } catch { return routes }
}

function parseJsonResponse(text: string): unknown {
  try { return JSON.parse(text) } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (!match) throw new Error("Impossible d'extraire le JSON")
    return JSON.parse(match[0])
  }
}

async function queryAI(provider: AIProvider, apiKey: string | undefined, message: string): Promise<string> {
  const ollamaConfig = provider === "ollama" ? loadOllamaConfig() : null

  if (isTauriAvailable()) {
    const { content } = await callAiProxyTauri({
      provider,
      apiKey,
      model: provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "openai" ? "gpt-4o" : provider === "gemini" ? "gemini-2.0-flash" : ollamaConfig?.model || "llama2",
      host: ollamaConfig?.host,
      port: ollamaConfig?.port,
      system: "You are an API route analysis assistant. Analyze backend routes and provide structured metadata: authentication, body types, middleware, confidence. Always respond with valid JSON only — no markdown, no prose, just a JSON array.",
      message,
    })
    return content
  }

  const response = await fetch("/api/proxy-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify({
      provider,
      apiKey,
      model: provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "openai" ? "gpt-4o" : provider === "gemini" ? "gemini-2.0-flash" : ollamaConfig?.model || "llama2",
      host: ollamaConfig?.host,
      port: ollamaConfig?.port,
      system: "You are an API route analysis assistant. Analyze backend routes and provide structured metadata: authentication, body types, middleware, confidence. Always respond with valid JSON only — no markdown, no prose, just a JSON array.",
      message,
    }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Erreur analyse IA")
  return data.content ?? ""
}
