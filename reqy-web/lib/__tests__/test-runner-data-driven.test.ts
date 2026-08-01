import { describe, it, expect } from "vitest"
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven"

describe("loadJsonDataset", () => {
  it("parses array of objects", () => {
    const json = JSON.stringify([{ a: "1" }, { a: "2" }])
    expect(loadJsonDataset(json)).toEqual([{ a: "1" }, { a: "2" }])
  })

  it("returns empty array for empty JSON array", () => {
    expect(loadJsonDataset("[]")).toEqual([])
  })

  it("throws on non-array JSON", () => {
    expect(() => loadJsonDataset('{"a":1}')).toThrow()
  })

  it("coerces non-string values to strings", () => {
    const json = JSON.stringify([{ a: 1, b: true, c: null }])
    expect(loadJsonDataset(json)).toEqual([{ a: "1", b: "true", c: "null" }])
  })
})

describe("loadCsvDataset", () => {
  it("parses simple CSV", () => {
    const csv = "a,b\n1,2\n3,4\n"
    expect(loadCsvDataset(csv)).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }])
  })

  it("handles quoted fields with commas", () => {
    const csv = 'name,desc\n"Alice","hello, world"\n'
    expect(loadCsvDataset(csv)).toEqual([{ name: "Alice", desc: "hello, world" }])
  })

  it("handles CRLF line endings", () => {
    const csv = "a,b\r\n1,2\r\n"
    expect(loadCsvDataset(csv)).toEqual([{ a: "1", b: "2" }])
  })

  it("returns empty array for empty input", () => {
    expect(loadCsvDataset("")).toEqual([])
  })

  it("returns empty array when only header present", () => {
    expect(loadCsvDataset("a,b\n")).toEqual([])
  })

  it("escapes double quotes inside quoted fields", () => {
    const csv = 'a\n"He said ""hi"""\n'
    expect(loadCsvDataset(csv)).toEqual([{ a: 'He said "hi"' }])
  })
})
