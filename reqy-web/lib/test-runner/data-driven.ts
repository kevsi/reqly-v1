export function loadJsonDataset(json: string): Record<string, string>[] {
  const parsed = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error("Dataset must be a JSON array")
  return parsed.map((row) => {
    if (typeof row !== "object" || row === null) throw new Error("Each row must be an object")
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) out[k] = String(v)
    return out
  })
}

export function loadCsvDataset(csv: string): Record<string, string>[] {
  const trimmed = csv.trim()
  if (!trimmed) return []
  const lines = parseCsvLines(trimmed)
  if (lines.length < 2) return []
  const [headers, ...dataLines] = lines
  return dataLines.map((fields) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = fields[i] ?? "" })
    return row
  })
}

function parseCsvLines(csv: string): string[][] {
  const lines: string[][] = []
  let current: string[] = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ",") { current.push(field); field = "" }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && csv[i + 1] === "\n") i++
        current.push(field); field = ""
        if (current.some((f) => f !== "")) lines.push(current)
        current = []
      } else field += ch
    }
  }
  if (field !== "" || current.length > 0) {
    current.push(field)
    if (current.some((f) => f !== "")) lines.push(current)
  }
  return lines
}
