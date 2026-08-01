import type { CaptureRule, RunResult, RunnerContext } from "./types.js"
import { resolveJsonPath, tryParseJson } from "./path-utils.js"

export function applyCaptures(captures: CaptureRule[], result: RunResult, ctx: RunnerContext): Record<string, string> {
  const captured: Record<string, string> = {}
  const body = tryParseJson(result.body)

  for (const rule of captures) {
    let value: unknown

    if (rule.expr.startsWith("body")) {
      const path = rule.expr.slice(4).replace(/^\./, "")
      value = path ? resolveJsonPath(body, path) : body
    } else if (rule.expr.startsWith("headers")) {
      const headerKey = rule.expr.slice(7).replace(/^\./, "").toLowerCase().replace(/-/g, "")
      for (const [key, val] of Object.entries(result.responseHeaders || {})) {
        if (key.toLowerCase().replace(/-/g, "") === headerKey) {
          value = val
          break
        }
      }
    } else if (rule.expr === "status") {
      value = String(result.status)
    } else if (rule.expr === "body") {
      value = JSON.stringify(body)
    }

    if (value !== undefined && value !== null) {
      const strVal = typeof value === "object" ? JSON.stringify(value) : String(value)
      captured[rule.name] = strVal
      ctx.vars.set(rule.name, strVal)
      ctx.envVars.set(rule.name, strVal)
    }
  }

  return captured
}

export function interpolate(text: string, ctx: RunnerContext): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, varName) => {
    const trimmed = varName.trim()
    const value = ctx.vars.get(trimmed)
    if (value !== undefined) return value
    const envValue = ctx.envVars.get(trimmed)
    if (envValue !== undefined) return envValue
    return `{{${trimmed}}}`
  })
}
