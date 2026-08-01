export interface GeneratedRequest {
  name: string
  method: string
  url: string
  endpoint?: string
  headers?: Record<string, string>
  body?: string
  queryParams?: Array<{ key: string; value: string }>
  rationale?: string
}

function inferMethod(description: string): string {
  const lower = description.toLowerCase()
  if (lower.includes("create") || lower.includes("add") || lower.includes("post ")) return "POST"
  if (lower.includes("update") || lower.includes("edit") || lower.includes("put ")) return "PUT"
  if (lower.includes("patch") || lower.includes("partial")) return "PATCH"
  if (lower.includes("delete") || lower.includes("remove") || lower.includes("destroy")) return "DELETE"
  return "GET"
}

function extractUrl(description: string): string | undefined {
  const urlPattern = /(https?:\/\/[^\s"'`<>]+)/i
  const match = description.match(urlPattern)
  if (match) return match[1]

  const pathPattern = /(?:to|at|from)\s+([/][^\s"'`<>]+)/i
  const pathMatch = description.match(pathPattern)
  if (pathMatch) return `https://api.example.com${pathMatch[1]}`

  return undefined
}

function extractHeaders(description: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const lower = description.toLowerCase()
  if (lower.includes("json")) headers["Content-Type"] = "application/json"
  if (lower.includes("xml")) headers["Content-Type"] = "application/xml"
  if (lower.includes("form")) headers["Content-Type"] = "application/x-www-form-urlencoded"
  return headers
}

export function generateRequestFromDescription(description: string): GeneratedRequest {
  const method = inferMethod(description)
  const url = extractUrl(description) ?? "https://api.example.com/"
  const headers = extractHeaders(description)

  let body: string | undefined
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const jsonMatch = description.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      body = jsonMatch[0]
    } else {
      body = "{}"
    }
  }

  return {
    name: `${method} ${new URL(url).pathname || "/"}`,
    method,
    url,
    endpoint: new URL(url).pathname || "/",
    headers,
    body,
    rationale: `Inferred ${method} request from description`,
  }
}
