import { describe, it, expect } from "vitest"
import { extractGraphqlReply } from "@/lib/graphql/extract-reply"

describe("extractGraphqlReply", () => {
  it("returns raw query when the model replies with just the operation", () => {
    const raw = "query Foo { bar }"
    expect(extractGraphqlReply(raw)).toBe("query Foo { bar }")
  })

  it("strips ```graphql fences", () => {
    const raw = "```graphql\nquery Foo { bar }\n```"
    expect(extractGraphqlReply(raw)).toBe("query Foo { bar }")
  })

  it("strips ``` fences without language tag", () => {
    const raw = "```\nquery Foo { bar }\n```"
    expect(extractGraphqlReply(raw)).toBe("query Foo { bar }")
  })

  it("extracts top-level .query field", () => {
    const raw = JSON.stringify({ query: "query Foo { bar }" })
    expect(extractGraphqlReply(raw)).toBe("query Foo { bar }")
  })

  it("extracts top-level .body field", () => {
    const raw = JSON.stringify({ body: "query Foo { bar }" })
    expect(extractGraphqlReply(raw)).toBe("query Foo { bar }")
  })

  it("extracts from actions[0].payload.body (Reqly AI protocol wrapper)", () => {
    const raw = JSON.stringify({
      summary: "Here you go",
      actions: [
        {
          type: "FILL_REQUEST",
          payload: {
            method: "POST",
            url: "/graphql",
            body: "query GetCountries { countries { code } }",
          },
        },
      ],
    })
    expect(extractGraphqlReply(raw)).toBe("query GetCountries { countries { code } }")
  })

  it("extracts from actions[0].payload.text", () => {
    const raw = JSON.stringify({
      actions: [{ payload: { text: "mutation AddStar { ok }" } }],
    })
    expect(extractGraphqlReply(raw)).toBe("mutation AddStar { ok }")
  })

  it("extracts from actions[0].payload.query", () => {
    const raw = JSON.stringify({
      actions: [{ payload: { query: "subscription Events { x }" } }],
    })
    expect(extractGraphqlReply(raw)).toBe("subscription Events { x }")
  })

  it("recurses through nested data.query wrapper", () => {
    const raw = JSON.stringify({
      data: { query: "query Nested { field }" },
    })
    expect(extractGraphqlReply(raw)).toBe("query Nested { field }")
  })

  it("handles malformed JSON with real newlines between every word (the bug)", () => {
    const raw = `{
  "summary": "The user wants to retrieve the first 5 countries, including their code and capital.",
  "actions": [
    {
      "type": "FILL_REQUEST",
      "payload": {
        "method": "POST",
        "body": "query { countries(first: 5) { code capital } }"
      }
    }
  ]
}`
    const result = extractGraphqlReply(raw)
    expect(result).toBe("query { countries(first: 5) { code capital } }")
  })

  it("handles extreme case where every token is on its own line (real newlines in strings)", () => {
    // This is what the user actually saw: literal newlines inside string values
    const raw = `{
  "summary": "The
user
wants
to
retrieve",
  "actions": [
    {
      "payload": {
        "body": "query
{
  countries
  {
    code
    capital
  }
}"
      }
    }
  ]
}`
    const result = extractGraphqlReply(raw)
    expect(result).toContain("query")
    expect(result).toContain("countries")
    expect(result).toContain("code")
    expect(result).toContain("capital")
  })

  it("returns trimmed raw text as last resort when nothing matches", () => {
    const raw = "no idea what to do"
    expect(extractGraphqlReply(raw)).toBe("no idea what to do")
  })

  it("returns empty string for empty input", () => {
    expect(extractGraphqlReply("")).toBe("")
  })

  it("handles mutation and subscription operations", () => {
    const raw = JSON.stringify({
      actions: [{ payload: { body: "mutation DoIt { ok }" } }],
    })
    expect(extractGraphqlReply(raw)).toBe("mutation DoIt { ok }")
  })
})
