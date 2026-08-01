/**
 * Postman integration — single barrel entry point.
 *
 * Replaces the historical split across `lib/postman.ts`, `lib/postman-api.ts`,
 * and `lib/postman-collection.ts`. Import everything from `@/lib/postman`.
 *
 * Sections in this file:
 *   1. API client (low-level HTTP, auth header, timeout, error class)
 *   2. High-level helpers (validate API key)
 *   3. v2.1 collection extractor (folders, requests, body modes, auth)
 */

// ─────────────────────────────────────────────────────────────────────────
// 1. API client
// ─────────────────────────────────────────────────────────────────────────

const POSTMAN_API_BASE = "https://api.postman.com"
const TIMEOUT_MS = 10000

export class PostmanApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "PostmanApiError"
  }
}

export async function postmanFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${POSTMAN_API_BASE}${path}`, {
      ...options,
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/vnd.api.v10+json",
        "User-Agent": "Reqly/1.0",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function postmanFetchJson<T = unknown>(
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await postmanFetch(apiKey, path, options)
  if (!res.ok) {
    let msg = ""
    try {
      const body = await res.json()
      msg = body?.error?.message ?? body?.message ?? ""
    } catch {
      /* body not JSON */
    }
    throw new PostmanApiError(res.status, msg || `Erreur Postman (HTTP ${res.status})`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────
// 2. High-level helpers
// ─────────────────────────────────────────────────────────────────────────

export interface PostmanUser {
  username: string
  email?: string
}

export async function validatePostmanApiKey(apiKey: string): Promise<PostmanUser> {
  try {
    const data = await postmanFetchJson<{ user?: { username?: string; email?: string }; username?: string; email?: string }>(apiKey, "/me")
    return {
      username: data.user?.username ?? data.username ?? "unknown",
      email: data.user?.email ?? data.email,
    }
  } catch (err) {
    if (err instanceof PostmanApiError) {
      if (err.status === 429) {
        throw new PostmanApiError(
          429,
          "Limite de requêtes Postman atteinte, réessayez plus tard"
        )
      }
      throw err
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new PostmanApiError(0, "Timeout : Postman n'a pas répondu en 10s")
    }
    throw new PostmanApiError(0, "Erreur réseau, réessayez")
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. v2.1 collection extractor
// ─────────────────────────────────────────────────────────────────────────

/**
 * The Reqly store schema (lib/types.ts) defines `bodyType` as one of:
 *   "json" | "form-data" | "x-www-form" | "raw" | "binary"
 * We mirror that exactly so the result can be written to the store without
 * unsafe casts. `"none"` is represented by leaving `bodyType` undefined.
 */
export type ExtractedBodyType =
  | "json"
  | "form-data"
  | "x-www-form"
  | "raw"
  | "binary"

export interface ExtractedRequest {
  id: string
  name: string
  method: string
  url: string
  endpoint: string
  headers: Record<string, string>
  body: string
  bodyType?: ExtractedBodyType
  queryParams: Array<{ key: string; value: string }>
  folderId: string | null
  authType: "none" | "bearer" | "basic" | "api-key" | "oauth2"
  authToken?: string
  createdAt: string
  updatedAt: string
}

export interface ExtractedFolder {
  id: string
  name: string
  parentId: string | null
}

export interface ExtractedCollection {
  folders: ExtractedFolder[]
  requests: ExtractedRequest[]
}

const SUPPORTED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "GRAPHQL",
])

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeMethod(raw: unknown): string {
  const upper = String(raw ?? "GET").toUpperCase()
  return SUPPORTED_METHODS.has(upper) ? upper : "GET"
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function headerArrayToObject(headers: unknown): Record<string, string> {
  if (!Array.isArray(headers)) return {}
  const out: Record<string, string> = {}
  for (const h of headers) {
    if (isPlainObject(h) && "key" in h && "value" in h) {
      const key = String((h as { key: unknown }).key)
      const value = String((h as { value: unknown }).value)
      if (key) out[key] = value
    }
  }
  return out
}

function parseQueryParams(urlObj: unknown): Array<{ key: string; value: string }> {
  if (!isPlainObject(urlObj)) return []
  const q = (urlObj as { query?: unknown }).query
  if (!Array.isArray(q)) return []
  const out: Array<{ key: string; value: string }> = []
  for (const item of q) {
    if (!isPlainObject(item)) continue
    const obj = item as { key?: unknown; value?: unknown; disabled?: unknown }
    if (obj.disabled) continue
    const key = String(obj.key ?? "").trim()
    if (!key) continue
    out.push({ key, value: String(obj.value ?? "") })
  }
  return out
}

function parseUrl(urlField: unknown): { raw: string; query: Array<{ key: string; value: string }> } {
  if (typeof urlField === "string") return { raw: urlField, query: [] }
  if (isPlainObject(urlField)) {
    const u = urlField as { raw?: unknown; query?: unknown }
    return {
      raw: typeof u.raw === "string" ? u.raw : "",
      query: parseQueryParams(u),
    }
  }
  return { raw: "", query: [] }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function buildEncodedForm(entries: unknown[]): string {
  const parts: string[] = []
  for (const e of entries) {
    if (!isPlainObject(e)) continue
    const obj = e as { key?: unknown; value?: unknown; disabled?: unknown; type?: unknown }
    if (obj.disabled) continue
    if (obj.type && obj.type !== "text") continue // skip file fields
    const key = String(obj.key ?? "").trim()
    if (!key) continue
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(obj.value ?? ""))}`,
    )
  }
  return parts.join("&")
}

function extractBody(
  req: unknown,
): { body: string; bodyType?: ExtractedBodyType } {
  if (!isPlainObject(req)) return { body: "" }
  const body = (req as { body?: unknown }).body
  if (!body) return { body: "" }

  if (typeof body === "string") return { body, bodyType: "raw" }

  if (!isPlainObject(body)) return { body: "" }
  const b = body as {
    mode?: unknown
    raw?: unknown
    urlencoded?: unknown
    formdata?: unknown
    file?: unknown
    graphql?: unknown
  }

  switch (b.mode) {
    case "raw": {
      if (typeof b.raw !== "string") return { body: "" }
      const looksLikeJson = safeJsonParse(b.raw) !== undefined
      return { body: b.raw, bodyType: looksLikeJson ? "json" : "raw" }
    }
    case "urlencoded": {
      if (!Array.isArray(b.urlencoded)) {
        return { body: "", bodyType: "x-www-form" }
      }
      return {
        body: buildEncodedForm(b.urlencoded),
        bodyType: "x-www-form",
      }
    }
    case "formdata": {
      if (!Array.isArray(b.formdata)) {
        return { body: "", bodyType: "form-data" }
      }
      return { body: buildEncodedForm(b.formdata), bodyType: "form-data" }
    }
    case "file": {
      const src = isPlainObject(b.file)
        ? (b.file as { src?: unknown }).src
        : undefined
      const name = typeof src === "string" ? src : "binary"
      return { body: `[binary file: ${name}]`, bodyType: "binary" }
    }
    case "graphql": {
      if (!isPlainObject(b.graphql)) return { body: "", bodyType: "json" }
      const g = b.graphql as { query?: unknown; variables?: unknown }
      const query = typeof g.query === "string" ? g.query : ""
      const variables =
        typeof g.variables === "string" ? g.variables : undefined
      const payload: Record<string, unknown> = { query }
      if (variables !== undefined) {
        const parsed = safeJsonParse(variables)
        payload.variables = parsed !== undefined ? parsed : variables
      }
      return { body: JSON.stringify(payload), bodyType: "json" }
    }
    default:
      return { body: "" }
  }
}

function encodeBasic(user: string, pass: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(`${user}:${pass}`).toString("base64")
  }
  // Browser fallback — btoa is available in both browser and modern Node.
  return btoa(`${user}:${pass}`)
}

function findAuthValue(entries: unknown, key: string): string | undefined {
  if (!Array.isArray(entries)) return undefined
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    const obj = entry as { key?: unknown; value?: unknown }
    if (obj.key === key && typeof obj.value === "string") return obj.value
  }
  return undefined
}

function extractAuth(req: unknown): {
  authType: ExtractedRequest["authType"]
  authToken?: string
} {
  if (!isPlainObject(req)) return { authType: "none" }
  const auth = (req as { auth?: unknown }).auth
  if (!isPlainObject(auth)) return { authType: "none" }
  const a = auth as {
    type?: unknown
    bearer?: unknown
    basic?: unknown
    apikey?: unknown
    oauth2?: unknown
  }
  switch (a.type) {
    case "bearer": {
      const token = findAuthValue(a.bearer, "token")
      return { authType: "bearer", ...(token ? { authToken: token } : {}) }
    }
    case "basic": {
      const username = findAuthValue(a.basic, "username") ?? ""
      const password = findAuthValue(a.basic, "password") ?? ""
      return { authType: "basic", authToken: encodeBasic(username, password) }
    }
    case "apikey": {
      const value = findAuthValue(a.apikey, "value")
      return { authType: "api-key", ...(value ? { authToken: value } : {}) }
    }
    case "oauth2": {
      const accessToken =
        findAuthValue(a.oauth2, "accessToken") ??
        findAuthValue(a.oauth2, "token")
      return {
        authType: "oauth2",
        ...(accessToken ? { authToken: accessToken } : {}) ,
      }
    }
    case "noauth":
      return { authType: "none" }
    default:
      return { authType: "none" }
  }
}

/**
 * Walk a Postman collection item tree and extract folders + requests.
 */
export function extractPostmanCollection(items: unknown): ExtractedCollection {
  const folders: ExtractedFolder[] = []
  const requests: ExtractedRequest[] = []

  function walk(subItems: unknown, parentId: string | null): void {
    if (!Array.isArray(subItems)) return
    for (const raw of subItems) {
      if (!isPlainObject(raw)) continue
      const item = raw as { name?: unknown; item?: unknown[]; request?: unknown }

      if (Array.isArray(item.item) && !item.request) {
        const folderId = randomId("folder")
        const name = typeof item.name === "string" && item.name.trim()
          ? item.name
          : "Folder"
        folders.push({ id: folderId, name, parentId })
        walk(item.item, folderId)
        continue
      }

      if (!item.request) continue

      const req = item.request as {
        method?: unknown
        url?: unknown
        header?: unknown
        body?: unknown
      }
      const method = normalizeMethod(req.method)
      const urlParsed = parseUrl(req.url)
      const headers = headerArrayToObject(req.header)
      const bodyParsed = extractBody(req)
      const auth = extractAuth(req)

      const name =
        typeof item.name === "string" && item.name.trim()
          ? item.name
          : `${method} ${urlParsed.raw || "/"}`

      const now = new Date().toISOString()
      requests.push({
        id: randomId("req"),
        name,
        method,
        url: urlParsed.raw || "/",
        endpoint: urlParsed.raw || "/",
        headers,
        body: bodyParsed.body,
        ...(bodyParsed.bodyType ? { bodyType: bodyParsed.bodyType } : {}),
        queryParams: urlParsed.query,
        folderId: parentId,
        authType: auth.authType,
        ...(auth.authToken ? { authToken: auth.authToken } : {}),
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  walk(items, null)
  return { folders, requests }
}
