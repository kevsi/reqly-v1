import { executeRequest as cliExecuteRequest, isUrlAllowed, DEFAULT_MAX_RESPONSE_SIZE } from "../runner.js"
import { evaluateAssertions, runResultToAssertionContext } from "./assertions.js"
import type { RequestItem, HttpMethod, RunResult, RunnerOptions, AssertionResult } from "./types.js"

export const VALID_METHODS: ReadonlyArray<string> = [
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
]

function buildEnvVarMap(environments: Array<{ name: string; variables: Array<{ key: string; value: string; enabled: boolean }> }>, envName?: string): Map<string, string> {
  const map = new Map<string, string>()
  if (envName && environments) {
    const env = environments.find((e) => e.name.toLowerCase() === envName.toLowerCase())
    if (env && env.variables) {
      for (const v of env.variables) {
        if (v.enabled) map.set(v.key, v.value)
      }
    }
  }
  return map
}

export async function executeRequest(
  request: RequestItem,
  options: RunnerOptions,
  environments?: Array<{ name: string; variables: Array<{ key: string; value: string; enabled: boolean }> }>
): Promise<RunResult> {
  if (request.method === "GRAPHQL") {
    const query = request.graphql?.query ?? request.body ?? ""
    return executeGraphQL(request.url, query, request.graphql?.variables, request.graphql?.operationName, request.headers, options)
  }

  const urlCheck = isUrlAllowed(request.url, options.allowLocalHosts)
  if (!urlCheck.allowed) {
    return {
      name: request.name,
      method: request.method,
      url: request.url,
      status: 0,
      statusText: "Blocked",
      durationMs: 0,
      size: 0,
      passed: false,
      error: urlCheck.reason,
    }
  }

  const envVars = buildEnvVarMap(environments ?? [], options.envName)
  const ctx = { vars: envVars, envVars, cookies: new Map<string, string>(), iteration: 0 }

  const result = await cliExecuteRequest(
    {
      name: request.name,
      method: request.method as any,
      url: request.url,
      headers: request.headers,
      body: request.body,
      bodyType: request.bodyType as any,
      authType: request.authType as any,
      authToken: request.authToken,
      queryParams: request.queryParams as any,
      graphql: request.graphql as any,
    },
    ctx,
    options.timeoutMs,
    { timeoutMs: options.timeoutMs, allowLocalHosts: options.allowLocalHosts, maxResponseSize: options.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE },
  )

  return {
    name: result.name,
    method: result.method as HttpMethod,
    url: result.url,
    status: result.status,
    statusText: result.statusText,
    durationMs: result.durationMs,
    size: result.size,
    passed: result.passed,
    error: result.error,
    body: result.body,
  }
}

export interface RunResultWithAssertions extends RunResult {
  assertionResults?: AssertionResult[]
  assertionsPassed?: boolean
}

export async function executeRequestWithAssertions(
  request: RequestItem,
  options: RunnerOptions,
  environments?: Array<{ name: string; variables: Array<{ key: string; value: string; enabled: boolean }> }>
): Promise<RunResultWithAssertions> {
  const result = await executeRequest(request, options, environments)
  const assertions = request.runnerAssertions?.filter((a) => a.enabled !== false)
  if (!assertions || assertions.length === 0) {
    return result
  }

  const assertionResults = evaluateAssertions(assertions, runResultToAssertionContext(result))
  const assertionsPassed = assertionResults.every((r) => r.passed)

  return {
    ...result,
    passed: result.passed && assertionsPassed,
    assertionResults,
    assertionsPassed,
  }
}

export async function executeGraphQL(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string,
  headers?: Record<string, string>,
  options: RunnerOptions = { timeoutMs: 30000 }
): Promise<RunResult> {
  const urlCheck = isUrlAllowed(url, options.allowLocalHosts)
  if (!urlCheck.allowed) {
    return {
      name: "GraphQL",
      method: "GRAPHQL" as HttpMethod,
      url,
      status: 0,
      statusText: "Blocked",
      durationMs: 0,
      size: 0,
      passed: false,
      error: urlCheck.reason,
    }
  }

  const body = JSON.stringify({
    query,
    variables: variables ?? {},
    operationName: operationName ?? undefined,
  })

  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers ?? {}),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  const startTime = Date.now()
  const maxSize = options.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: reqHeaders,
      body,
      signal: controller.signal,
    })

    const durationMs = Date.now() - startTime
    const text = await response.text()
    const size = Buffer.byteLength(text, "utf8")
    const passed = response.status < 400

    if (size > maxSize) {
      return {
        name: "GraphQL",
        method: "GRAPHQL" as HttpMethod,
        url,
        status: 0,
        statusText: "Blocked",
        durationMs,
        size,
        passed: false,
        error: `Response exceeds maximum allowed size of ${maxSize} bytes`,
      }
    }

    return {
      name: query.split(/\s+/).slice(0, 3).join(" ") || "GraphQL",
      method: "GRAPHQL" as HttpMethod,
      url,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      size,
      passed,
      body: text,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const message = error instanceof Error ? error.message : String(error)
    const isTimeout = error instanceof DOMException && error.name === "AbortError"
    return {
      name: "GraphQL",
      method: "GRAPHQL" as HttpMethod,
      url,
      status: 0,
      statusText: isTimeout ? "Timeout" : "Error",
      durationMs,
      size: 0,
      passed: false,
      error: isTimeout ? `Request timed out after ${options.timeoutMs}ms` : message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export interface ValidationIssue {
  field: string
  severity: "error" | "warning"
  message: string
}

export function validateRequest(request: Partial<RequestItem>): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!request.name || !request.name.trim()) {
    issues.push({ field: "name", severity: "error", message: "Request name is required" })
  }

  if (!request.url || !request.url.trim()) {
    issues.push({ field: "url", severity: "error", message: "Request URL is required" })
  } else {
    try { new URL(request.url) } catch {
      issues.push({ field: "url", severity: "error", message: `Invalid URL: ${request.url}` })
    }
  }

  if (request.method && !VALID_METHODS.includes(request.method)) {
    issues.push({ field: "method", severity: "error", message: `Invalid HTTP method: ${request.method}` })
  }

  if (request.body && request.bodyType === "json") {
    try { JSON.parse(request.body) } catch {
      issues.push({ field: "body", severity: "warning", message: "Body is marked as JSON but is not valid JSON" })
    }
  }

  if (request.authType && request.authType !== "none" && !request.authToken) {
    issues.push({ field: "authToken", severity: "warning", message: `Auth type is ${request.authType} but no token provided` })
  }

  return issues
}
