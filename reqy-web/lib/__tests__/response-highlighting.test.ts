import { describe, it, expect } from "vitest"
import { highlightJson, highlightMarkup, escapeHtml } from "@/components/response-utils"

describe("highlightJson", () => {
  it("does not double-encode apostrophes in JSON strings", () => {
    const rawJson = '{\n  "message": "Bienvenue sur l\'API simple !"\n}'
    const result = highlightJson(rawJson)

    expect(result).toContain("l&#x27;API")
    expect(result).not.toContain("&amp;#x27;")
  })

  it("escapes XSS payloads in JSON values safely", () => {
    const rawJson = '{"unsafe": "<script>alert(\'xss\')</script>"}'
    const result = highlightJson(rawJson)

    expect(result).toContain("&lt;script&gt;")
    expect(result).toContain("&#x27;")
  })

  it("escapes & characters correctly", () => {
    const rawJson = '{"message": "a & b"}'
    const result = highlightJson(rawJson)

    expect(result).toContain("&amp; b")
  })

  it("escapes backticks correctly", () => {
    const rawJson = '{"code": "`template`"}'
    const result = highlightJson(rawJson)

    expect(result).toContain("&#x60;")
  })

  it("applies key colors (sky) and value colors (amber)", () => {
    const rawJson = '{"name": "test"}'
    const result = highlightJson(rawJson)

    expect(result).toContain('text-sky-300">&quot;name&quot;:</span>')
    expect(result).toContain('text-amber-300">&quot;test&quot;</span>')
  })

  it("colorizes booleans and null", () => {
    const rawJson = '{"ok": true, "missing": null}'
    const result = highlightJson(rawJson)

    expect(result).toContain("text-violet-300")
    expect(result).toContain("text-orange-300")
  })

  it("colorizes numbers", () => {
    const rawJson = '{"n": 42, "f": 3.14}'
    const result = highlightJson(rawJson)

    expect(result).toContain("text-rose-300")
  })
})

describe("highlightMarkup", () => {
  it("preserves existing HTML entities without double-escaping", () => {
    const xml = `<div title="test&#x27;s">hello</div>`
    const result = highlightMarkup(xml)

    expect(result).toContain("&#x27;")
    expect(result).not.toContain("&amp;#x27;")
  })

  it("escapes raw XSS content in markup", () => {
    const html = `<div><script>alert(1)</script></div>`
    const result = highlightMarkup(html)

    expect(result).toContain("&lt;script")
    expect(result).toContain("&gt;")
    expect(result).not.toContain("<script>")
  })
})

describe("escapeHtml", () => {
  it("escaping order prevents double-entity mangling", () => {
    expect(escapeHtml("&")).toBe("&amp;")
    expect(escapeHtml("<")).toBe("&lt;")
    expect(escapeHtml(">")).toBe("&gt;")
    expect(escapeHtml('"')).toBe("&quot;")
    expect(escapeHtml("'")).toBe("&#x27;")
    expect(escapeHtml("`")).toBe("&#x60;")
  })
})
