import { proxyAuthHeaders } from "@/lib/proxy-auth"

// Deep introspection query: GraphQL wraps non-null/list types via ofType,
// with up to 4 levels for a type like [Foo!]! — NON_NULL > LIST > NON_NULL >
// NamedType. We fetch 6 levels of ofType to be safe and avoid the "Unknown!"
// bug where the leaf OBJECT name falls off the introspection response.
//
// Each level is a separate fragment so the response stays readable.
const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      fields {
        name
        description
        args {
          name
          description
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                    ofType {
                      kind
                      name
                      ofType {
                        kind
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                    ofType {
                      kind
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`

export const INTROSPECTION_QUERY_STRING = INTROSPECTION_QUERY

interface ProxySuccessBody {
  status: number
  body: string
  headers: Record<string, string>
  durationMs: number
}

interface ProxyErrorBody {
  error?: string
  status?: number
}

/**
 * Introspect a GraphQL endpoint via the proxy server.
 * This avoids direct fetch() calls from the browser and routes through
 * the Next.js middleware (auth-checked /api/proxy endpoint).
 */
export async function introspectSchema(endpoint: string, headers?: Record<string, string>): Promise<string> {
  const proxyRes = await fetch("/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify({
      url: endpoint,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    }),
  })

  const proxyData: ProxySuccessBody | ProxyErrorBody = await proxyRes.json().catch(() => ({
    error: "Invalid proxy response",
  }))

  const isError = !proxyRes.ok || "error" in proxyData

  if (isError) {
    const errBody = proxyData as ProxyErrorBody
    throw new Error(errBody.error ?? `Proxy request failed (HTTP ${proxyRes.status})`)
  }

  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse((proxyData as ProxySuccessBody).body)
  } catch {
    /* body is not JSON */
  }

  const data = (json && typeof json === "object" && "data" in json)
    ? (json as { data: unknown }).data
    : json

  return JSON.stringify(data ?? {})
}

export function endpointHash(endpoint: string): string {
  let hash = 0
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) - hash + endpoint.charCodeAt(i)) | 0
  }
  return `gql-${Math.abs(hash).toString(36)}`
}
