export function inferSchemaFromValue(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: {} }
    const itemSchemas = value.map(inferSchemaFromValue)
    const uniqueSchemas = dedupeSchemas(itemSchemas)
    if (uniqueSchemas.length === 1) return { type: "array", items: uniqueSchemas[0] }
    return { type: "array", items: { allOf: uniqueSchemas } }
  }
  if (typeof value === "object") {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferSchemaFromValue(v)
      required.push(k)
    }
    return { type: "object", properties, required }
  }
  if (typeof value === "number") return { type: "number" }
  if (typeof value === "boolean") return { type: "boolean" }
  return { type: "string" }
}

function dedupeSchemas(schemas: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  return schemas.filter((s) => {
    const key = JSON.stringify(s)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
