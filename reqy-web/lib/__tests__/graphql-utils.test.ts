import { describe, it, expect } from 'vitest'
import {
  buildGraphQLRequest,
  parseGraphQLResponse,
  INTROSPECTION_QUERY,
} from '@/lib/graphql-utils'

describe('buildGraphQLRequest', () => {
  it('returns query only when no variables or operationName', () => {
    const result = buildGraphQLRequest('query { hello }', {})
    expect(JSON.parse(result.body)).toEqual({ query: 'query { hello }' })
  })

  it('includes variables when provided', () => {
    const result = buildGraphQLRequest('query($id: ID!) { user(id: $id) { name } }', { id: '123' })
    expect(JSON.parse(result.body)).toEqual({
      query: 'query($id: ID!) { user(id: $id) { name } }',
      variables: { id: '123' },
    })
  })

  it('includes operationName when provided', () => {
    const result = buildGraphQLRequest('query GetUser { user { name } }', {}, 'GetUser')
    expect(JSON.parse(result.body)).toEqual({
      query: 'query GetUser { user { name } }',
      operationName: 'GetUser',
    })
  })

  it('includes both variables and operationName', () => {
    const result = buildGraphQLRequest(
      'query GetUser($id: ID!) { user(id: $id) { name } }',
      { id: '456' },
      'GetUser'
    )
    expect(JSON.parse(result.body)).toEqual({
      query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
      variables: { id: '456' },
      operationName: 'GetUser',
    })
  })

  it('trims operationName', () => {
    const result = buildGraphQLRequest('query { hello }', {}, '  MyOp  ')
    expect(JSON.parse(result.body)).toEqual({
      query: 'query { hello }',
      operationName: 'MyOp',
    })
  })

  it('ignores empty variables object', () => {
    const result = buildGraphQLRequest('query { hello }', {})
    const parsed = JSON.parse(result.body)
    expect(parsed).not.toHaveProperty('variables')
  })
})

describe('parseGraphQLResponse', () => {
  it('parses valid GraphQL response with data', () => {
    const body = JSON.stringify({ data: { user: { name: 'Alice' } } })
    const result = parseGraphQLResponse(body)
    expect(result.data).toEqual({ user: { name: 'Alice' } })
    expect(result.errors).toBeUndefined()
  })

  it('parses valid GraphQL response with errors', () => {
    const body = JSON.stringify({
      errors: [{ message: 'Field not found', path: ['user'] }],
    })
    const result = parseGraphQLResponse(body)
    expect(result.errors).toHaveLength(1)
    expect(result.errors![0].message).toBe('Field not found')
    expect(result.data).toBeUndefined()
  })

  it('parses response with both data and errors', () => {
    const body = JSON.stringify({
      data: { user: null },
      errors: [{ message: 'Not authorized' }],
    })
    const result = parseGraphQLResponse(body)
    expect(result.data).toEqual({ user: null })
    expect(result.errors).toHaveLength(1)
  })

  it('returns error for invalid JSON', () => {
    const result = parseGraphQLResponse('not json')
    expect(result.errors).toHaveLength(1)
    expect(result.errors![0].message).toBe('Invalid JSON response from GraphQL server')
    expect(result.data).toBeUndefined()
  })

  it('handles empty string', () => {
    const result = parseGraphQLResponse('')
    expect(result.errors).toHaveLength(1)
    expect(result.errors![0].message).toBe('Invalid JSON response from GraphQL server')
  })

  it('returns no data for empty object JSON', () => {
    const result = parseGraphQLResponse('{}')
    expect(result.data).toBeUndefined()
    expect(result.errors).toBeUndefined()
  })
})

describe('INTROSPECTION_QUERY', () => {
  it('contains __schema query', () => {
    expect(INTROSPECTION_QUERY).toContain('__schema')
    expect(INTROSPECTION_QUERY).toContain('types')
    expect(INTROSPECTION_QUERY).toContain('directives')
  })

  it('is a non-empty string', () => {
    expect(INTROSPECTION_QUERY.length).toBeGreaterThan(100)
  })
})
