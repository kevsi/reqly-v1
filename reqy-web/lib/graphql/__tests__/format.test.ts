import { describe, it, expect } from "vitest"
import { formatGraphQL, typeLabel, type SchemaFieldType } from "@/lib/graphql/format"

describe("formatGraphQL", () => {
  it("formats a simple query", () => {
    expect(formatGraphQL("query Foo { bar }")).toBe("query Foo {\n  bar\n}")
  })

  it("returns empty for empty input", () => {
    expect(formatGraphQL("")).toBe("")
  })
})

describe("typeLabel", () => {
  it("returns 'Unknown' for undefined input", () => {
    expect(typeLabel(undefined)).toBe("Unknown")
    expect(typeLabel(null)).toBe("Unknown")
  })

  it("returns 'Unknown' for an object with no name and no ofType", () => {
    expect(typeLabel({ kind: "OBJECT" })).toBe("Unknown")
  })

  it("renders a plain OBJECT type by name", () => {
    const t: SchemaFieldType = { kind: "OBJECT", name: "Country" }
    expect(typeLabel(t)).toBe("Country")
  })

  it("renders a NON_NULL wrapping a named type with a bang", () => {
    const t: SchemaFieldType = {
      kind: "NON_NULL",
      ofType: { kind: "OBJECT", name: "Country" },
    }
    expect(typeLabel(t)).toBe("Country!")
  })

  it("renders a SCALAR NON_NULL like String!", () => {
    const t: SchemaFieldType = {
      kind: "NON_NULL",
      ofType: { kind: "SCALAR", name: "String" },
    }
    expect(typeLabel(t)).toBe("String!")
  })

  it("renders a LIST wrapping a named type", () => {
    const t: SchemaFieldType = {
      kind: "LIST",
      ofType: { kind: "OBJECT", name: "Country" },
    }
    expect(typeLabel(t)).toBe("[Country]")
  })

  it("renders [Country!]! (the bug case)", () => {
    const t: SchemaFieldType = {
      kind: "NON_NULL",
      ofType: {
        kind: "LIST",
        ofType: {
          kind: "NON_NULL",
          ofType: { kind: "OBJECT", name: "Country" },
        },
      },
    }
    expect(typeLabel(t)).toBe("[Country!]!")
  })

  it("renders [Country!] (non-null inner, nullable outer)", () => {
    const t: SchemaFieldType = {
      kind: "LIST",
      ofType: {
        kind: "NON_NULL",
        ofType: { kind: "OBJECT", name: "Country" },
      },
    }
    expect(typeLabel(t)).toBe("[Country!]")
  })

  it("renders [Country]! (nullable inner, non-null outer)", () => {
    const t: SchemaFieldType = {
      kind: "NON_NULL",
      ofType: {
        kind: "LIST",
        ofType: { kind: "OBJECT", name: "Country" },
      },
    }
    expect(typeLabel(t)).toBe("[Country]!")
  })

  it("renders [String!]!", () => {
    const t: SchemaFieldType = {
      kind: "NON_NULL",
      ofType: {
        kind: "LIST",
        ofType: {
          kind: "NON_NULL",
          ofType: { kind: "SCALAR", name: "String" },
        },
      },
    }
    expect(typeLabel(t)).toBe("[String!]!")
  })

  it("does NOT emit 'Unknown!' when ofType is missing in NON_NULL", () => {
    const t: SchemaFieldType = { kind: "NON_NULL", name: "Country" }
    expect(typeLabel(t)).not.toMatch(/^Unknown!$/)
    expect(typeLabel(t)).toBe("Country!")
  })

  it("does NOT emit 'Unknown![]' when ofType is missing in LIST", () => {
    const t: SchemaFieldType = { kind: "LIST", name: "Country" }
    expect(typeLabel(t)).not.toMatch(/Unknown.*\[\]/)
    expect(typeLabel(t)).toBe("Country[]")
  })

  it("handles ENUM types", () => {
    const t: SchemaFieldType = { kind: "ENUM", name: "Role" }
    expect(typeLabel(t)).toBe("Role")
  })

  it("renders NON_NULL ENUM", () => {
    const t: SchemaFieldType = {
      kind: "NON_NULL",
      ofType: { kind: "ENUM", name: "Role" },
    }
    expect(typeLabel(t)).toBe("Role!")
  })
})
