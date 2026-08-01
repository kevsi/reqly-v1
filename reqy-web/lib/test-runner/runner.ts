import { evaluateAssertions } from "./assertions"
import { runScript } from "./scripts"
import type {
  CollectionRunReport, RequestResponse, RunnerContext,
  RequestTestResult, Assertion,
} from "./types"
import type { Collection, RequestItem } from "@/hooks/request-types"

export interface RunnerOptions {
  executor: (req: { method: string; url: string; headers: Record<string, string>; body?: unknown }) => Promise<RequestResponse>
  iterations?: RunnerContext[]
  perRequestTimeoutMs?: number
  scriptTimeoutMs?: number
}

export async function runCollection(
  collection: Collection,
  baseContext: RunnerContext,
  options: RunnerOptions
): Promise<CollectionRunReport> {
  const startedAt = Date.now()
  const contexts = options.iterations ?? [baseContext]
  const results: RequestTestResult[] = []

  for (const ctx of contexts) {
    for (const req of collection.requests) {
      results.push(await runOne(req, ctx, options))
    }
  }

  const completedAt = Date.now()
  return {
    collectionId: collection.id,
    collectionName: collection.name,
    startedAt,
    completedAt,
    totalDurationMs: completedAt - startedAt,
    results,
    summary: summarize(results),
  }
}

async function runOne(
  req: RequestItem,
  ctx: RunnerContext,
  options: RunnerOptions
): Promise<RequestTestResult> {
  const result: RequestTestResult = {
    requestId: req.id, requestName: req.name,
    status: "skipped", assertionResults: [],
  }

  // Pre script
  const preScript = (req as unknown as { preRequestScript?: string }).preRequestScript
  if (preScript) {
    const out = await runScript(preScript, ctx, { phase: "pre", timeoutMs: options.scriptTimeoutMs })
    if (out.error) {
      result.status = "errored"
      result.error = `Pre-script error: ${out.error}`
      return result
    }
    result.scriptOutput = { ...(result.scriptOutput ?? {}), pre: out.consoleLines.join("\n") }
  }

  // HTTP
  let response: RequestResponse
  try {
    response = await options.executor({
      method: req.method,
      url: interpolate(req.url, ctx),
      headers: headersToRecord(req.headers, ctx),
      body: req.body ? interpolate(req.body, ctx) : undefined,
    })
  } catch (err) {
    result.status = "errored"
    result.error = err instanceof Error ? err.message : String(err)
    return result
  }
  result.statusCode = response.statusCode
  result.responseTimeMs = response.responseTimeMs

  // Post script
  const postScript = (req as unknown as { postResponseScript?: string }).postResponseScript
  if (postScript) {
    const out = await runScript(postScript, ctx, { phase: "post", response, timeoutMs: options.scriptTimeoutMs })
    if (out.error) {
      result.status = "errored"
      result.error = `Post-script error: ${out.error}`
      return result
    }
    result.scriptOutput = { ...(result.scriptOutput ?? {}), post: out.consoleLines.join("\n") }
  }

  // Assertions
  const assertions = ((req as unknown as { runnerAssertions?: Assertion[] }).runnerAssertions ?? []) as Assertion[]
  result.assertionResults = evaluateAssertions(assertions, response)
  result.status = result.assertionResults.every((r) => r.passed) ? "pass" : "fail"
  return result
}

function interpolate(value: string, ctx: RunnerContext): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx.environment[k] ?? ctx.iterationData[k] ?? `{{${k}}}`)
}

function headersToRecord(
  headers: Record<string, string> | undefined,
  ctx: RunnerContext
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [key, value] of Object.entries(headers)) {
    out[key] = interpolate(value, ctx)
  }
  return out
}

function summarize(results: RequestTestResult[]) {
  const s: { total: number; passed: number; failed: number; skipped: number; errored: number } = {
    total: results.length, passed: 0, failed: 0, skipped: 0, errored: 0,
  }
  for (const r of results) {
    if (r.status === "pass") s.passed++
    else if (r.status === "fail") s.failed++
    else if (r.status === "skipped") s.skipped++
    else if (r.status === "errored") s.errored++
  }
  return s
}
