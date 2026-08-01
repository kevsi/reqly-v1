import type { CollectionRunRecord, RequestRunRecord, AssertionResult } from "./types.js"

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function failureXml(result: RequestRunRecord): string {
  const failureMessages = (result.assertionResults ?? [])
    .filter((r: AssertionResult) => !r.passed)
    .map((r: AssertionResult) => r.error ?? `Assertion failed: ${JSON.stringify(r.actualValue)}`)

  if (result.error) {
    return `<error message="${escapeXml(result.error)}">${escapeXml(result.error)}</error>`
  }

  if (failureMessages.length === 0) return ""

  const msg = failureMessages.join("; ")
  const detail = (result.assertionResults ?? [])
    .filter((r: AssertionResult) => !r.passed)
    .map((r: AssertionResult) => {
      const assertion = r.assertion as { type: string; target?: string; value?: string }
      return `  ${JSON.stringify(assertion)}\n    expected: ${JSON.stringify(assertion.value ?? null)}\n    actual:   ${JSON.stringify(r.actualValue)}`
    })
    .join("\n")

  return `<failure message="${escapeXml(msg)}">${escapeXml(detail)}</failure>`
}

export function collectionRunRecordToJUnitXml(report: CollectionRunRecord): string {
  const name = escapeXml(report.collectionName)
  const time = (report.totalDurationMs / 1000).toFixed(3)
  const cases = report.results
    .map((r) => {
      const t = ((r.durationMs ?? 0) / 1000).toFixed(3)
      return `    <testcase name="${escapeXml(r.requestName)}" classname="${name}" time="${t}">${failureXml(r)}</testcase>`
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
