import { describe, it, expect } from "vitest"
import { buildQueryFromSelections } from "@/lib/graphql/query-builder"

describe("buildQueryFromSelections", () => {
  it("returns empty string for no selections", () => {
    expect(buildQueryFromSelections([])).toBe("")
  })

  it("builds a simple query with default operation name", () => {
    const selections = [{ field: "hello", args: {}, subfields: [] }]
    const result = buildQueryFromSelections(selections)
    expect(result).toBe("query GeneratedQuery {\n  hello\n}")
  })

  it("builds a query with custom operation name (legacy 2-arg signature)", () => {
    const selections = [{ field: "countries", args: {}, subfields: ["code", "name"] }]
    const result = buildQueryFromSelections(selections, "GetCountries")
    expect(result).toContain("query GetCountries")
    expect(result).toContain("countries")
    expect(result).toContain("code")
    expect(result).toContain("name")
  })

  it("builds a mutation when operation type is mutation", () => {
    const selections = [{ field: "addStar", args: { repoId: '"x"' }, subfields: ["starrable"] }]
    const result = buildQueryFromSelections(selections, "mutation", "AddStar")
    expect(result.startsWith("mutation AddStar")).toBe(true)
    expect(result).toContain("addStar(repoId: \"x\")")
    expect(result).toContain("starrable")
  })

  it("builds a subscription when operation type is subscription", () => {
    const selections = [{ field: "onMessage", args: {}, subfields: ["id", "body"] }]
    const result = buildQueryFromSelections(selections, "subscription", "Sub")
    expect(result.startsWith("subscription Sub")).toBe(true)
  })

  it("builds a query with arguments", () => {
    const selections = [
      { field: "country", args: { code: '"FR"' }, subfields: ["name", "capital"] },
    ]
    const result = buildQueryFromSelections(selections)
    expect(result).toContain('country(code: "FR")')
    expect(result).toContain("name")
    expect(result).toContain("capital")
  })

  it("builds nested subfields with proper indentation", () => {
    const selections = [
      {
        field: "country",
        args: { code: '"US"' },
        subfields: [
          { field: "continent", args: {}, subfields: ["name"] },
        ],
      },
    ]
    const result = buildQueryFromSelections(selections)
    expect(result).toContain("country(code: \"US\")")
    expect(result).toContain("continent")
    expect(result).toContain("name")
    expect(result).toMatch(/^ {4}continent/m)
  })

  it("builds deeply nested subfields (3 levels)", () => {
    const selections = [
      {
        field: "country",
        args: {},
        subfields: [
          {
            field: "continent",
            args: {},
            subfields: [
              { field: "countries", args: {}, subfields: ["code"] },
            ],
          },
        ],
      },
    ]
    const result = buildQueryFromSelections(selections)
    expect(result).toContain("country")
    expect(result).toContain("continent")
    expect(result).toContain("countries")
    expect(result).toContain("code")
  })

  it("treats unknown operation type name as a literal name (legacy compat)", () => {
    const selections = [{ field: "x", args: {}, subfields: [] }]
    const result = buildQueryFromSelections(selections, "MyWeirdName")
    expect(result.startsWith("query MyWeirdName")).toBe(true)
  })
})
