import { describe, it, expect } from "vitest"
import {
  convertToRequestTestAssertions,
  convertToRunnerAssertions,
} from "@/lib/ai-assertion-converter"

describe("convertToRequestTestAssertions", () => {
  it("converts status assertions", () => {
    const [assertion] = convertToRequestTestAssertions([
      { label: "Status 200", code: "expect(response.status).toBe(200);" },
    ])
    expect(assertion.type).toBe("status")
    expect(assertion.target).toBe("200")
  })

  it("converts body contains assertions", () => {
    const [assertion] = convertToRequestTestAssertions([
      { label: "Has id", code: "expect(response.body).toContain('user');" },
    ])
    expect(assertion.type).toBe("bodyContains")
    expect(assertion.target).toBe("user")
  })
})

describe("convertToRunnerAssertions", () => {
  it("converts status and response time", () => {
    const result = convertToRunnerAssertions([
      { label: "Status 200", code: "expect(response.status).toBe(200);" },
      { label: "Fast", code: "expect(responseTime < 1000);" },
    ])
    expect(result[0]).toEqual({ type: "status", expected: 200 })
    expect(result[1]).toEqual({ type: "responseTime", operator: "<", valueMs: 1000 })
  })

  it("does not extract status from comments (false positive)", () => {
    const result = convertToRunnerAssertions([
      { label: "Some assertion", code: "// Check if status 200 is returned\nexpect(response.body).toHaveProperty('id');" },
    ])
    expect(result.some((a) => a.type === "status")).toBe(false)
  })

  it("does not extract status from multi-line comments", () => {
    const result = convertToRunnerAssertions([
      { label: "Some assertion", code: "/* expect status 200 */\nexpect(response.body).toHaveProperty('id');" },
    ])
    expect(result.some((a) => a.type === "status")).toBe(false)
  })
})
