export interface GraphQLRequestPayload {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

export interface GraphQLResponse {
  data?: unknown
  errors?: Array<{
    message: string
    path?: (string | number)[]
    locations?: Array<{ line: number; column: number }>
    extensions?: Record<string, unknown>
  }>
}

export function buildGraphQLRequest(
  query: string,
  variables: Record<string, unknown>,
  operationName?: string
): { endpoint: string; body: string } {
  const payload: GraphQLRequestPayload = { query }

  if (Object.keys(variables).length > 0) {
    payload.variables = variables
  }

  if (operationName && operationName.trim()) {
    payload.operationName = operationName.trim()
  }

  return {
    endpoint: "",
    body: JSON.stringify(payload),
  }
}

export function parseGraphQLResponse(body: string): GraphQLResponse {
  try {
    const parsed = JSON.parse(body)
    return {
      data: parsed.data,
      errors: parsed.errors,
    }
  } catch {
    return {
      errors: [{ message: "Invalid JSON response from GraphQL server" }],
    }
  }
}

export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args {
          ...InputValue
        }
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }

  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }

  fragment TypeRef on __Type {
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
`
