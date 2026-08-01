import { describe, it, expect } from "vitest"
import { toJUnitXml } from "@/lib/test-runner/junit-export"
import type { CollectionRunReport, RequestTestResult } from "@/lib/test-runner/types"

const passResult: RequestTestResult = {
  requestId: "r1", requestName: "GET /users", status: "pass",
  statusCode: 200, responseTimeMs: 123, assertionResults: [],
}

const failResult: RequestTestResult = {
  requestId: "r2", requestName: "POST /login", status: "fail",
  statusCode: 401, responseTimeMs: 200,
  assertionResults: [{
    assertion: { type: "status", expected: 200 },
    passed: false, actualValue: 401, error: "Status expected 200 but got 401",
  }],
}

const errorResult: RequestTestResult = {
  requestId: "r3", requestName: "GET /error", status: "errored",
  error: "Network timeout", assertionResults: [],
}

const report: CollectionRunReport = {
  collectionId: "c1", collectionName: "My Collection",
  startedAt: 0, completedAt: 1000, totalDurationMs: 1000,
  results: [passResult, failResult, errorResult],
  summary: { total: 3, passed: 1, failed: 1, skipped: 0, errored: 1 },
}

describe("toJUnitXml", () => {
  it("produces valid XML with testsuites root", () => {
    const xml = toJUnitXml(report)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain("<testsuites")
    expect(xml).toContain('name="My Collection"')
    expect(xml).toContain('tests="3"')
    expect(xml).toContain('failures="1"')
    expect(xml).toContain('errors="1"')
  })

  it("emits testcase with failure for failing tests", () => {
    const xml = toJUnitXml(report)
    expect(xml).toContain('<testcase name="POST /login"')
    expect(xml).toContain("<failure")
    expect(xml).toContain("Status expected 200 but got 401")
  })

  it("emits empty testcase for passing tests", () => {
    const xml = toJUnitXml(report)
    expect(xml).toContain('<testcase name="GET /users"')
  })

  it("emits error element for errored tests", () => {
    const xml = toJUnitXml(report)
    expect(xml).toContain('<testcase name="GET /error"')
    expect(xml).toContain("<error")
    expect(xml).toContain("Network timeout")
  })

  it("escapes special characters in names", () => {
    const r: CollectionRunReport = {
      ...report,
      collectionName: 'My <Collection> & "Co"',
      results: [{ ...passResult, requestName: "GET /foo<bar>baz" }],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, errored: 0 },
    }
    const xml = toJUnitXml(r)
    expect(xml).toContain("&lt;Collection&gt;")
    expect(xml).toContain("&amp;")
    expect(xml).toContain("foo&lt;bar&gt;baz")
  })
})
