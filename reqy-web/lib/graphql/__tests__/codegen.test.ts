import { describe, it, expect } from "vitest"
import {
  generateFetchSnippet,
  generateCurlSnippet,
  generateTypeScriptStub,
} from "@/lib/graphql/codegen"

describe("generateFetchSnippet", () => {
  it("produces valid JS fetch code", () => {
    const code = generateFetchSnippet({
      endpoint: "https://api.example.com/graphql",
      query: "{ hello }",
      variables: {},
      headers: { Authorization: "Bearer token" },
    })
    expect(code).toContain("fetch")
    expect(code).toContain("https://api.example.com/graphql")
    expect(code).toContain("{ hello }")
    expect(code).toContain("Bearer token")
  })

  it("handles missing headers and variables", () => {
    const code = generateFetchSnippet({
      endpoint: "https://x",
      query: "{ a }",
    })
    expect(code).toContain("Content-Type")
    expect(code).not.toContain("undefined")
  })
})

describe("generateCurlSnippet", () => {
  it("produces valid curl command", () => {
    const code = generateCurlSnippet({
      endpoint: "https://api.example.com/graphql",
      query: "{ hello }",
      variables: {},
      headers: { Authorization: "Bearer token" },
    })
    expect(code).toContain("curl")
    expect(code).toContain("-X POST")
    expect(code).toContain("Authorization: Bearer token")
  })

  it("encodes single quotes via JSON escaping", () => {
    const code = generateCurlSnippet({
      endpoint: "https://x",
      query: `{ a(b: "it's") }`,
    })
    expect(code).toContain("-d")
    // JSON.stringify escapes the double quotes around "it's"
    expect(code).toMatch(/\\"it/)
  })
})

describe("generateTypeScriptStub", () => {
  it("generates an interface with the given fields", () => {
    const code = generateTypeScriptStub("GetUser", ["id", "name", "email"])
    expect(code).toContain("interface GetUserResponse")
    expect(code).toContain("id: unknown")
    expect(code).toContain("name: unknown")
    expect(code).toContain("email: unknown")
  })

  it("handles empty fields gracefully", () => {
    const code = generateTypeScriptStub("Empty", [])
    expect(code).toContain("interface EmptyResponse")
    expect(code).toContain("// no fields detected")
  })
})
