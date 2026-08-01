import type { RequestResponse } from "@/lib/test-runner/types"

export interface GraphQLRequest {
  endpoint: string
  query: string
  variables?: Record<string, unknown>
  operationName?: string
  headers?: Record<string, string>
}

export interface GraphQLError {
  message: string
  path?: (string | number)[]
  extensions?: Record<string, unknown>
}

export interface GraphQLExecuteResult extends Omit<RequestResponse, "body"> {
  data?: unknown
  errors?: GraphQLError[]
  graphqlBody: { data?: unknown; errors?: GraphQLError[] } | unknown
}
