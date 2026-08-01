export interface SelectionNode {
  field: string
  args: Record<string, string>
  subfields: string[] | SelectionNode[]
}

export type GraphQLOperationType = "query" | "mutation" | "subscription"

function renderArgs(args: Record<string, string>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ""
  return `(${entries.map(([k, v]) => `${k}: ${v}`).join(", ")})`
}

function renderFields(fields: string[] | SelectionNode[], indent: string): string {
  if (fields.length === 0) return ""
  const lines = fields.map((f) => {
    if (typeof f === "string") return `${indent}${f}`
    const node = f as SelectionNode
    const args = renderArgs(node.args)
    const sub = renderFields(node.subfields, indent + "  ")
    return sub ? `${indent}${node.field}${args} {\n${sub}\n${indent}}` : `${indent}${node.field}${args}`
  })
  return lines.join("\n")
}

export function buildQueryFromSelections(
  selections: SelectionNode[],
  operationTypeOrName?: GraphQLOperationType | string,
  operationName?: string,
): string {
  if (selections.length === 0) return ""

  // Back-compat: accept (selections, "Foo") as (selections, operationName)
  // New signature: (selections, "mutation" | "query" | "subscription", operationName?)
  let opType: GraphQLOperationType = "query"
  let opName = "GeneratedQuery"
  if (typeof operationTypeOrName === "string") {
    if (
      operationTypeOrName === "query" ||
      operationTypeOrName === "mutation" ||
      operationTypeOrName === "subscription"
    ) {
      opType = operationTypeOrName
      opName = operationName ?? "Generated"
    } else {
      opName = operationTypeOrName
    }
  }

  const body = selections
    .map((sel) => {
      const args = renderArgs(sel.args)
      const sub = renderFields(sel.subfields, "    ")
      return sub ? `  ${sel.field}${args} {\n${sub}\n  }` : `  ${sel.field}${args}`
    })
    .join("\n")
  return `${opType} ${opName} {\n${body}\n}`
}
