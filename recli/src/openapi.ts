import yaml from "js-yaml"
import type { ExportBundle, RequestItem, Collection, HttpMethod } from "./types.js"

interface OAS3Doc {
  openapi: string
  info?: { title?: string; description?: string; version?: string }
  paths: Record<string, Record<string, OAS3Operation>>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, OASSecurityScheme>
  }
  servers?: Array<{ url: string; description?: string }>
}

interface OAS3Operation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: Array<{
    name: string
    in: "query" | "header" | "path" | "cookie"
    required?: boolean
    schema?: { type?: string; default?: unknown }
    example?: unknown
  }>
  requestBody?: {
    required?: boolean
    content: Record<string, { schema?: unknown; example?: unknown }>
  }
  security?: Array<Record<string, string[]>>
  responses: Record<string, unknown>
}

interface OASSecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect"
  scheme?: string
  name?: string
  in?: string
  flows?: unknown
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"]

export function importOpenAPI(specYamlOrJson: string): ExportBundle {
  let doc: OAS3Doc
  try {
    doc = JSON.parse(specYamlOrJson)
  } catch {
    // Use js-yaml for robust YAML parsing (supports arrays, anchors, multi-line, etc.)
    try {
      doc = yaml.load(specYamlOrJson) as OAS3Doc
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`Failed to parse OpenAPI spec: ${msg}`)
    }
  }

  if (!doc.openapi || !doc.paths) {
    throw new Error("Invalid OpenAPI spec: missing 'openapi' version or 'paths'")
  }

  const baseUrl = doc.servers?.[0]?.url || "http://localhost"
  const collectionName = doc.info?.title || "OpenAPI Import"
  const requests: RequestItem[] = []

  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op: OAS3Operation | undefined = (methods as any)[method]
      if (!op) continue

      const name = op.operationId || op.summary || `${method.toUpperCase()} ${path}`
      let url = `${baseUrl}${path}`
      const queryParams: Array<{ key: string; value: string }> = []
      const headers: Record<string, string> = {}
      let body: string | undefined

      if (op.parameters) {
        for (const param of op.parameters) {
          if (param.in === "query") {
            queryParams.push({
              key: param.name,
              value: param.example !== undefined ? String(param.example) : param.schema?.default !== undefined ? String(param.schema.default) : "",
            })
          } else if (param.in === "header") {
            headers[param.name] = param.example !== undefined ? String(param.example) : ""
          } else if (param.in === "path") {
            url = url.replace(`{${param.name}}`, param.example !== undefined ? String(param.example) : `:${param.name}`)
          }
        }
      }

      if (op.requestBody) {
        const jsonContent = op.requestBody.content?.["application/json"]
        if (jsonContent?.example) {
          body = JSON.stringify(jsonContent.example, null, 2)
        } else if (jsonContent?.schema) {
          body = JSON.stringify(generateExampleFromSchema(jsonContent.schema as Record<string, unknown>), null, 2)
        }
      }

      const httpMethod = method.toUpperCase() as HttpMethod
      if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"].includes(httpMethod)) continue

      requests.push({
        name,
        method: httpMethod,
        url,
        endpoint: path,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        bodyType: body ? "json" : undefined,
        queryParams: queryParams.length > 0 ? queryParams : undefined,
        description: op.summary || op.description,
      })
    }
  }

  const collection: Collection = {
    name: collectionName,
    description: `Imported from OpenAPI spec: ${doc.info?.version || "unknown version"}`,
    requests,
  }

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [collection],
  }
}

function generateExampleFromSchema(schema: Record<string, unknown>): unknown {
  if (schema.example !== undefined) return schema.example
  if (schema.type === "object" && schema.properties) {
    const result: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
      result[key] = generateExampleFromSchema(prop as Record<string, unknown>)
    }
    return result
  }
  if (schema.type === "array") {
    const items = schema.items ? generateExampleFromSchema(schema.items as Record<string, unknown>) : ""
    return [items]
  }
  if (schema.type === "string") {
    if (schema.enum && Array.isArray(schema.enum)) return schema.enum[0]
    if ((schema as any).format === "date-time") return new Date().toISOString()
    if ((schema as any).format === "email") return "user@example.com"
    if ((schema as any).format === "uri") return "https://example.com"
    if ((schema as any).format === "uuid") return "550e8400-e29b-41d4-a716-446655440000"
    return "string"
  }
  if (schema.type === "integer" || schema.type === "number") return 0
  if (schema.type === "boolean") return false
  return null
}
