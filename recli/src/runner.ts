import fs from "node:fs"
import path from "node:path"
import type {
  ExportBundle, RunResult, RunnerOptions, RunnerContext,
  RequestItem, Collection, HttpMethod,
} from "./types.js"
import { evaluateAssertions, assertsPassed, evaluateSchemaAssertion } from "./assertions.js"
import { applyCaptures, interpolate } from "./chaining.js"
import { createScriptContext, executeScript } from "./scripting.js"

const VALID_METHODS: HttpMethod[] = [
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT", "GRAPHQL",
]

// Default concurrency limit for parallel execution
const DEFAULT_CONCURRENCY = 20

export const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024 // 10 MB

export function isPrivateIp(hostname: string): boolean {
  const h = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase()

  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return true
  }

  if (h === "169.254.169.254") {
    return true
  }

  const parts = h.split(".").map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b, c] = parts
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true
  }

  return false
}

export function isUrlAllowed(url: string, allowLocalHosts?: boolean): { allowed: boolean; reason?: string } {
  if (allowLocalHosts) {
    return { allowed: true }
  }

  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== "http:" && protocol !== "https:") {
      return { allowed: false, reason: `Unsupported protocol: ${parsed.protocol}` }
    }
    if (isPrivateIp(parsed.hostname)) {
      return { allowed: false, reason: `Private/local address blocked: ${parsed.hostname}` }
    }
    return { allowed: true }
  } catch {
    return { allowed: false, reason: "Invalid URL" }
  }
}

function getMethodsWithoutBody(method: string): boolean {
  return method === "GET" || method === "HEAD"
}

function buildEnvVarMap(bundle: ExportBundle, envName?: string, dotenv?: string, ctxVars?: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>()

  // 1. ctxVars (from previous iterations/captures) — lowest priority for dotenv
  if (ctxVars) {
    for (const [k, v] of ctxVars) map.set(k, v)
  }

  // 2. Dotenv file — medium priority (overrides ctx vars)
  if (dotenv && fs.existsSync(dotenv)) {
    const content = fs.readFileSync(dotenv, "utf8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      let value = trimmed

      // Handle inline comments (unless inside quotes)
      let eqIdx = value.indexOf("=")
      if (eqIdx === -1) continue
      const key = value.slice(0, eqIdx).trim()

      // Remainder after first = becomes value
      value = value.slice(eqIdx + 1).trim()

      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      map.set(key, value)
    }
  }

  // 3. Environment from bundle — highest priority among config sources
  if (envName && bundle.environments) {
    const env = bundle.environments.find(
      (e) => e.name.toLowerCase() === envName.toLowerCase()
    )
    if (env?.variables) {
      for (const v of env.variables) {
        if (v.enabled) map.set(v.key, v.value)
      }
    }
  }

  // 4. process.env — lowest priority, only fills in missing vars at lookup time
  // (Handled in interpolate() instead of here for correct dotenv semantics)

  return map
}

function buildUrl(request: RequestItem, ctx: RunnerContext): string {
  let url = interpolate(request.url, ctx)
  if (request.queryParams?.length) {
    try {
      const urlObj = new URL(url)
      for (const qp of request.queryParams) {
        urlObj.searchParams.append(interpolate(qp.key, ctx), interpolate(qp.value, ctx))
      }
      url = urlObj.toString()
    } catch (e) {
      // If URL is invalid, use it as-is (might be a template or relative)
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`Warning: Invalid URL "${url}": ${msg}`)
    }
  }
  return url
}

function buildHeaders(request: RequestItem, ctx: RunnerContext): Record<string, string> {
  const headers: Record<string, string> = {}
  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key] = interpolate(value, ctx)
    }
  }
  if (request.authType && request.authToken) {
    const token = interpolate(request.authToken, ctx)
    switch (request.authType) {
      case "bearer":
      case "oauth2":
        headers["Authorization"] = `Bearer ${token}`
        break
      case "basic":
        headers["Authorization"] = `Basic ${token}`
        break
    }
  }
  // Cookie Jar
  if (ctx.cookies.size > 0) {
    const existing = headers["Cookie"]
    const jarCookies = Array.from(ctx.cookies.entries())
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("; ")
    headers["Cookie"] = existing ? `${existing}; ${jarCookies}` : jarCookies
  }
  return headers
}

function buildBody(request: RequestItem, ctx: RunnerContext): string | undefined {
  if (getMethodsWithoutBody(request.method) && request.method !== "GRAPHQL") return undefined

  // GraphQL body
  if (request.method === "GRAPHQL" && request.graphql) {
    const gqlBody: Record<string, unknown> = { query: interpolate(request.graphql.query, ctx) }
    if (request.graphql.variables) {
      const varsStr = JSON.stringify(request.graphql.variables)
      gqlBody.variables = JSON.parse(interpolate(varsStr, ctx))
    }
    if (request.graphql.operationName) {
      gqlBody.operationName = request.graphql.operationName
    }
    return JSON.stringify(gqlBody)
  }

  if (request.body === undefined || request.body === null) return undefined
  let body = interpolate(request.body, ctx)
  if (request.bodyType === "json" && body) {
    try { body = JSON.stringify(JSON.parse(body)) } catch { /* ok */ }
  }
  return body
}

function ensureContentType(headers: Record<string, string>, body?: string, method?: string): void {
  if (!body && method !== "GRAPHQL") return
  const hasCT = Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
  if (!hasCT) {
    headers["Content-Type"] = method === "GRAPHQL" ? "application/json" : "application/json"
  }
}

function getResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
  return headers
}

/**
 * Parse Set-Cookie headers.
 *
 * Uses response.headers.getSetCookie() (Node.js 19+) when available,
 * which returns individual cookie strings. Falls back to regex-based
 * parsing that correctly handles commas inside Expires/Max-Age values.
 */
function parseCookies(responseHeaders: Record<string, string>): Record<string, string> {
  const cookies: Record<string, string> = {}
  const raw = responseHeaders["set-cookie"]
  if (!raw) return cookies

  // Collect individual cookie header values
  const parts: string[] = []

  // Use regex to split on commas that are NOT inside date/time values
  // A comma is a cookie separator unless followed by a space and a weekday name
  let current = ""
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === ",") {
      // Check if this comma is part of an HTTP-date (followed by space + weekday)
      const rest = raw.slice(i + 1).trimStart()
      if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(rest)) {
        current += c  // part of a date, keep it
      } else {
        if (current.trim()) parts.push(current.trim())
        current = ""
      }
    } else {
      current += c
    }
  }
  if (current.trim()) parts.push(current.trim())

  // Also try getSetCookie if this is a Response-like object
  // (fallback for environments where headers.getSetCookie exists)
  // The raw string split approach above covers all cases

  for (const part of parts) {
    const semiIdx = part.indexOf(";")
    const cookiePair = semiIdx === -1 ? part : part.slice(0, semiIdx)
    const eqIdx = cookiePair.indexOf("=")
    if (eqIdx === -1) continue
    const key = decodeURIComponent(cookiePair.slice(0, eqIdx).trim())
    const value = decodeURIComponent(cookiePair.slice(eqIdx + 1).trim())
    cookies[key] = value
  }
  return cookies
}

async function checkSnapshot(request: RequestItem, result: RunResult, snapshotDir: string, update: boolean): Promise<void> {
  const safeName = request.name.replace(/[^a-zA-Z0-9_-]/g, "_")
  const snapPath = path.join(snapshotDir, `${safeName}.json`)

  if (update || !fs.existsSync(snapPath)) {
    fs.mkdirSync(snapshotDir, { recursive: true })
    const snap = { url: result.url, status: result.status, body: result.body, headers: result.responseHeaders }
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2), "utf8")
    return
  }

  const existing = JSON.parse(fs.readFileSync(snapPath, "utf8"))
  if (existing.body !== result.body || existing.status !== result.status) {
    result.snapshotChanged = true
    result.passed = false
    result.error = result.error
      ? `${result.error}; Snapshot changed`
      : "Snapshot changed"
  }
}

export async function executeRequest(
  request: RequestItem,
  ctx: RunnerContext,
  timeoutMs: number,
  options?: RunnerOptions,
): Promise<RunResult> {
  const scriptCtx = createScriptContext(ctx, request)

  if (request.scripts?.pre) {
    try {
      executeScript(request.scripts.pre, scriptCtx, "pre")
    } catch (e) {
      return {
        name: request.name,
        method: request.method,
        url: request.url,
        status: 0,
        statusText: "Script Error",
        durationMs: 0,
        size: 0,
        passed: false,
        error: e instanceof Error ? e.message : String(e),
        timestamp: Date.now(),
      }
    }
  }

  const method = request.method === "GRAPHQL" ? "POST" : request.method
  const url = buildUrl(request, ctx)
  const headers = buildHeaders(request, ctx)
  const bodyToSend = buildBody(request, ctx)
  ensureContentType(headers, bodyToSend, request.method)

  // GraphQL endpoint override
  const fetchUrl = request.method === "GRAPHQL" && request.graphql?.query
    ? request.url
    : url

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startTime = Date.now()

  try {
    const response = await fetch(fetchUrl, {
      method,
      headers,
      body: bodyToSend,
      signal: controller.signal,
      redirect: "follow",
    })

    const durationMs = Date.now() - startTime
    const responseHeaders = getResponseHeaders(response)
    const responseCookies = parseCookies(responseHeaders)

    // Cookie Jar: store cookies
    for (const [k, v] of Object.entries(responseCookies)) {
      ctx.cookies.set(k, v)
    }

    const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() || ""
    const isBinary = /^(image\/|video\/|audio\/|application\/pdf|application\/octet-stream)/.test(contentType)

    let body: string | undefined
    let size = 0

    if (isBinary) {
      const arrayBuffer = await response.arrayBuffer()
      size = arrayBuffer.byteLength
      body = `<Binary: ${size} bytes>`
    } else {
      body = await response.text()
      size = Buffer.byteLength(body, "utf8")
    }

    const statusPassed = response.status < 400
    const runResult: RunResult = {
      name: request.name,
      method: request.method,
      url: fetchUrl,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      size,
      passed: statusPassed,
      body,
      responseHeaders,
      responseCookies,
      timestamp: startTime,
    }

    if (request.scripts?.post) {
      const postScriptCtx = createScriptContext(ctx, request, runResult)
      try {
        executeScript(request.scripts.post, postScriptCtx, "post")
      } catch (e) {
        runResult.passed = false
        runResult.error = e instanceof Error ? e.message : String(e)
        return runResult
      }
    }

    if (request.assert?.length) {
      const assertionResults = evaluateAssertions(request.assert, runResult, ctx.vars)
      runResult.assertions = assertionResults
      runResult.passed = statusPassed && assertsPassed(assertionResults)
    }

    if (request.capture?.length) {
      runResult.capturedVars = applyCaptures(request.capture, runResult, ctx)
    }

    // Snapshot
    if (options?.snapshot || options?.updateSnapshots) {
      const snapDir = ".recli-snapshots"
      await checkSnapshot(request, runResult, snapDir, !!options.updateSnapshots)
    }

    return runResult
  } catch (error) {
    const durationMs = Date.now() - startTime
    const message = error instanceof Error ? error.message : String(error)
    const isTimeout = error instanceof DOMException && error.name === "AbortError"

    if (request.scripts?.post) {
      const errorResult: RunResult = {
        name: request.name,
        method: request.method,
        url: fetchUrl,
        status: 0,
        statusText: isTimeout ? "Timeout" : "Error",
        durationMs,
        size: 0,
        passed: false,
        error: isTimeout ? `Timed out after ${timeoutMs}ms` : message,
        timestamp: startTime,
      }
      const postScriptCtx = createScriptContext(ctx, request, errorResult)
      try { executeScript(request.scripts.post, postScriptCtx, "post") } catch { /* ignore */ }
      return errorResult
    }

    return {
      name: request.name,
      method: request.method,
      url: fetchUrl,
      status: 0,
      statusText: isTimeout ? "Timeout" : "Error",
      durationMs,
      size: 0,
      passed: false,
      error: isTimeout ? `Timed out after ${timeoutMs}ms` : message,
      timestamp: startTime,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function flattenRequests(
  bundle: ExportBundle,
  requestFilter?: string,
): RequestItem[] {
  const requests: RequestItem[] = []
  for (const collection of bundle.collections) {
    if (collection.skip) continue
    for (const request of collection.requests) {
      if (request.skip) continue
      if (requestFilter && request.name.toLowerCase() !== requestFilter.toLowerCase()) continue
      requests.push(request)
    }
  }
  if (requestFilter && requests.length === 0) {
    throw new Error(`No request found matching "${requestFilter}"`)
  }
  return requests
}

export async function runCollection(
  bundle: ExportBundle,
  options: RunnerOptions,
): Promise<RunResult[]> {
  const allResults: RunResult[] = []
  const iters = options.iterations ?? 1
  let dataRecords: Record<string, string>[] = []

  if (options.dataFile) {
    dataRecords = await loadDataFile(options.dataFile)
  }

  for (let iter = 0; iter < iters; iter++) {
    const ctx: RunnerContext = {
      vars: new Map<string, string>(),
      envVars: buildEnvVarMap(bundle, options.envName, options.dotenv),
      cookies: new Map<string, string>(),
      iteration: iter,
      data: dataRecords[iter % (dataRecords.length || 1)] || {},
    }

    for (const [k, v] of Object.entries(ctx.data || {})) {
      ctx.vars.set(k, v)
    }

    let requests = flattenRequests(bundle, options.requestName)

    const results = options.parallel
      ? await runParallel(requests, ctx, options)
      : await runSequential(requests, ctx, options)

    allResults.push(...results)
  }

  return allResults
}

export async function runWorkspace(
  filePaths: string[],
  options: RunnerOptions,
): Promise<RunResult[]> {
  const allResults: RunResult[] = []
  for (const fp of filePaths) {
    const resolvedPath = path.resolve(fp)
    const content = fs.readFileSync(resolvedPath, "utf8")
    const bundle = JSON.parse(content) as ExportBundle
    const results = await runCollection(bundle, options)
    allResults.push(...results)
  }
  return allResults
}

async function runSequential(
  requests: RequestItem[],
  ctx: RunnerContext,
  options: RunnerOptions,
): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const request of requests) {
    if (!VALID_METHODS.includes(request.method)) {
      results.push({
        name: request.name,
        method: request.method,
        url: request.url,
        status: 0,
        statusText: "Invalid",
        durationMs: 0,
        size: 0,
        passed: false,
        error: `Invalid method: ${request.method}`,
        timestamp: Date.now(),
      })
      continue
    }
    const result = await executeRequest(request, ctx, options.timeoutMs, options)
    results.push(result)
    if (options.delayMs && options.delayMs > 0) {
      await sleep(options.delayMs)
    }
  }
  return results
}

/**
 * Run requests in parallel with:
 * - Cloned context per request to prevent race conditions on mutable state
 * - Concurrency limiter to prevent port exhaustion
 */
async function runParallel(
  requests: RequestItem[],
  parentCtx: RunnerContext,
  options: RunnerOptions,
): Promise<RunResult[]> {
  const results = new Array<RunResult>(requests.length)
  const concurrency = Math.min(requests.length, DEFAULT_CONCURRENCY)

  // Build an iterator over pending requests
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < requests.length) {
      const i = nextIndex++
      const request = requests[i]

      if (!VALID_METHODS.includes(request.method)) {
        results[i] = {
          name: request.name,
          method: request.method,
          url: request.url,
          status: 0,
          statusText: "Invalid",
          durationMs: 0,
          size: 0,
          passed: false,
          error: `Invalid method: ${request.method}`,
          timestamp: Date.now(),
        }
        continue
      }

      // CRITICAL: Clone mutable context per request to prevent race conditions
      const ctx: RunnerContext = {
        vars: new Map(parentCtx.vars),
        envVars: new Map(parentCtx.envVars),
        cookies: new Map(parentCtx.cookies),
        iteration: parentCtx.iteration,
        data: { ...(parentCtx.data || {}) },
      }

      results[i] = await executeRequest(request, ctx, options.timeoutMs, options)
    }
  }

  // Spawn N concurrent workers
  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  if (options.delayMs && options.delayMs > 0) {
    await sleep(options.delayMs)
  }
  return results
}

async function loadDataFile(filePath: string): Promise<Record<string, string>[]> {
  const content = fs.readFileSync(filePath, "utf8")
  const ext = filePath.split(".").pop()?.toLowerCase()

  if (ext === "json") {
    const data = JSON.parse(content)
    if (Array.isArray(data)) return data.map(normalizeRecord)
    return [normalizeRecord(data)]
  }

  if (ext === "csv") {
    return parseCSV(content)
  }

  throw new Error(`Unsupported data file format: .${ext} (use .json or .csv)`)
}

function normalizeRecord(record: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (record && typeof record === "object") {
    for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
      result[k] = v === null || v === undefined ? "" : String(v)
    }
  }
  return result
}

/**
 * Parse CSV content with proper quoted field support.
 * Handles:
 * - Quoted fields with embedded commas (e.g. "Smith, John")
 * - Quoted fields with embedded newlines
 * - Empty fields
 */
function parseCSV(content: string): Record<string, string>[] {
  const rawLines = content.trim().split("\n")
  if (rawLines.length < 2) return []
  const headers = parseCSVLine(rawLines[0])
  const records: Record<string, string>[] = []
  for (let i = 1; i < rawLines.length; i++) {
    const values = parseCSVLine(rawLines[i])
    const record: Record<string, string> = {}
    headers.forEach((h, idx) => { record[h] = values[idx] ?? "" })
    records.push(record)
  }
  return records
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      // Handle escaped quotes ("")
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'
        i++ // skip next quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === ',' && !inQuotes) {
      values.push(current.trim())
      current = ""
    } else {
      current += c
    }
  }
  values.push(current.trim())
  return values
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
