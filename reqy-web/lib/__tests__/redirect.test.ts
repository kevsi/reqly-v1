import { describe, it, expect } from "vitest"
import { safeRedirect } from "@/lib/redirect"

describe("safeRedirect", () => {
  it.each([
    [null, "/"],
    [undefined, "/"],
    ["", "/"],
    ["/", "/"],
    ["/collections", "/collections"],
    ["/settings#profile", "/settings#profile"],
    ["/collections?filter=active", "/collections?filter=active"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["file:///etc/passwd", "/"],
    ["../../etc/passwd", "/"],
  ])("safeRedirect(%j) returns %j", (input, expected) => {
    expect(safeRedirect(input as string | null | undefined)).toBe(expected)
  })

  it("honors custom fallback", () => {
    expect(safeRedirect(null, "/dashboard")).toBe("/dashboard")
    expect(safeRedirect("//evil.com", "/dashboard")).toBe("/dashboard")
  })
})
