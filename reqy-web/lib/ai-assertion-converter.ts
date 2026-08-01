import type { TestAssertion } from "@/src/ai/engine"
import type { RequestTestAssertion } from "@/lib/types"
import type { Assertion } from "@/lib/test-runner/types"

function makeId(): string {
  return `assert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function stripCodeComments(code: string): string {
  return code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
}

function extractStatus(code: string): number | null {
  const stripped = stripCodeComments(code)
  const match =
    stripped.match(
      /(?:response|res)\.status\)[^.]*\.(?:toBe|toEqual|equal)\(\s*(\d{3})\s*\)/i,
    ) ??
    stripped.match(/status\s*===?\s*(\d{3})/i) ??
    stripped.match(/status[^\d]{0,12}(\d{3})/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function extractBodyContains(code: string): string | null {
  const match = code.match(/(?:toContain|includes|contain)\(\s*['"]([^'"]+)['"]\s*\)/i)
  return match?.[1] ?? null
}

function extractHeader(code: string): { name: string; expected?: string } | null {
  const match = code.match(
    /headers(?:\?)?\.(?:\[['"]([^'"]+)['"]\]|(\w+))[^'"\n]*?(?:toContain|includes|contain|toBe|toEqual)\(\s*['"]([^'"]*)['"]\s*\)/i,
  )
  if (!match) {
    const existsMatch = code.match(/headers(?:\?)?\.(?:\[['"]([^'"]+)['"]\]|(\w+))/i)
    if (!existsMatch) return null
    return { name: existsMatch[1] || existsMatch[2] }
  }
  return { name: match[1] || match[2], expected: match[3] }
}

function extractJsonPath(code: string): { path: string; expected?: string; operator: "exists" | "equals" } | null {
  const dollarMatch = code.match(/\$\.[\w.]+/)
  if (dollarMatch) {
    const equalsMatch = code.match(/(?:toBe|toEqual|equal)\(\s*['"]?([^'")\s]+)['"]?\s*\)/i)
    return {
      path: dollarMatch[0],
      expected: equalsMatch?.[1],
      operator: equalsMatch ? "equals" : "exists",
    }
  }

  const jsonMatch = code.match(/(?:json\(\)|\.json\(\))\.([\w.]+)/i)
  if (jsonMatch) {
    const equalsMatch = code.match(/(?:toBe|toEqual|equal)\(\s*['"]?([^'")\s]+)['"]?\s*\)/i)
    return {
      path: `$.${jsonMatch[1]}`,
      expected: equalsMatch?.[1],
      operator: equalsMatch ? "equals" : "exists",
    }
  }

  return null
}

function extractResponseTimeMs(code: string): number | null {
  const match =
    code.match(/(?:responseTime|duration|time)\s*[<>=]+\s*(\d+)/i) ??
    code.match(/(\d+)\s*ms/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

export function convertToRequestTestAssertions(items: TestAssertion[]): RequestTestAssertion[] {
  return items.map((item) => {
    const code = item.code.trim()
    const label = item.label.trim()

    const status = extractStatus(code)
    if (status !== null) {
      return {
        id: makeId(),
        type: "status",
        target: String(status),
        enabled: true,
      }
    }

    const body = extractBodyContains(code)
    if (body) {
      return {
        id: makeId(),
        type: "bodyContains",
        target: body,
        enabled: true,
      }
    }

    const header = extractHeader(code)
    if (header) {
      return {
        id: makeId(),
        type: "headerExists",
        target: header.name,
        expected: header.expected,
        enabled: true,
      }
    }

    const jsonPath = extractJsonPath(code)
    if (jsonPath) {
      return {
        id: makeId(),
        type: "jsonPath",
        target: jsonPath.path,
        expected: jsonPath.expected,
        enabled: true,
      }
    }

    return {
      id: makeId(),
      type: "bodyContains",
      target: label || code.slice(0, 120),
      expected: code,
      enabled: true,
    }
  })
}

export function convertToRunnerAssertions(items: TestAssertion[]): Assertion[] {
  const out: Assertion[] = []

  for (const item of items) {
    const code = item.code.trim()

    const status = extractStatus(code)
    if (status !== null) {
      out.push({ type: "status", expected: status })
      continue
    }

    const responseTimeMs = extractResponseTimeMs(code)
    if (responseTimeMs !== null) {
      out.push({ type: "responseTime", operator: "<", valueMs: responseTimeMs })
      continue
    }

    const jsonPath = extractJsonPath(code)
    if (jsonPath) {
      out.push({
        type: "jsonPath",
        path: jsonPath.path,
        operator: jsonPath.operator,
        value: jsonPath.expected,
      })
      continue
    }

    const header = extractHeader(code)
    if (header?.name.toLowerCase() === "content-type" && header.expected) {
      continue
    }

    const body = extractBodyContains(code)
    if (body) {
      out.push({
        type: "jsonPath",
        path: "$",
        operator: "contains",
        value: body,
      })
    }
  }

  return out
}
