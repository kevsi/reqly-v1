import type { CollectionRunReport, RequestTestResult } from "./types"

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function failureXml(result: RequestTestResult): string {
  const failureMessages = result.assertionResults
    .filter((r) => !r.passed)
    .map((r) => r.error ?? `Assertion failed: ${JSON.stringify(r.actualValue)}`)
  if (result.status === "errored") {
    return `<error message="${escape(result.error ?? "Unknown error")}">${escape(result.error ?? "")}</error>`
  }
  if (failureMessages.length === 0) return ""
  const msg = failureMessages.join("; ")
  const detail = result.assertionResults
    .filter((r) => !r.passed)
    .map((r) => `  ${JSON.stringify(r.assertion)}\n    expected: ${JSON.stringify((r.assertion as { value?: unknown }).value ?? null)}\n    actual:   ${JSON.stringify(r.actualValue)}`)
    .join("\n")
  return `<failure message="${escape(msg)}">${escape(detail)}</failure>`
}

export function toJUnitXml(report: CollectionRunReport): string {
  const name = escape(report.collectionName)
  const time = (report.totalDurationMs / 1000).toFixed(3)
  const cases = report.results
    .map((r) => {
      const t = ((r.responseTimeMs ?? 0) / 1000).toFixed(3)
      return `    <testcase name="${escape(r.requestName)}" classname="${name}" time="${t}">${failureXml(r)}</testcase>`
    })
    .join("\n")

  const { total, failed, errored } = report.summary
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${name}" tests="${total}" failures="${failed}" errors="${errored}" time="${time}">
  <testsuite name="${name}" tests="${total}" failures="${failed}" errors="${errored}" time="${time}">
${cases}
  </testsuite>
</testsuites>
`
}
