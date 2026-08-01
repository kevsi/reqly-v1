import { describe, it, expect } from 'vitest'
import { getValueByPath, isSourcePathSyntaxValid, parseResponseForExtraction, extractValueFromResponse } from '@/lib/variable-path'

describe('isSourcePathSyntaxValid', () => {
  it('accepts valid paths', () => {
    expect(isSourcePathSyntaxValid('data.items[0].id')).toBe(true)
    expect(isSourcePathSyntaxValid('user.name')).toBe(true)
    expect(isSourcePathSyntaxValid('')).toBe(true)
  })

  it('accepts paths with $-prefix', () => {
    expect(isSourcePathSyntaxValid('$.id')).toBe(true)
  })

  it('rejects paths with special characters', () => {
    expect(isSourcePathSyntaxValid('data items')).toBe(false)
  })
})

describe('getValueByPath', () => {
  const data = {
    user: { name: 'Alice', age: 30 },
    items: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ],
  }

  it('extracts nested value', () => {
    const result = getValueByPath(data, 'user.name')
    expect(result.success).toBe(true)
    expect(result.value).toBe('Alice')
  })

  it('extracts array item by index', () => {
    const result = getValueByPath(data, 'items[0].id')
    expect(result.success).toBe(true)
    expect(result.value).toBe(1)
  })

  it('returns full value for empty path', () => {
    const result = getValueByPath(data, '')
    expect(result.success).toBe(true)
    expect(result.value).toBe(data)
  })

  it('returns error for nonexistent path', () => {
    const result = getValueByPath(data, 'user.nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Path not found')
  })

  it('returns error for invalid path format', () => {
    const result = getValueByPath(data, 'invalid path!!')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid path format')
  })
})

describe('parseResponseForExtraction', () => {
  it('parses valid JSON', () => {
    const result = parseResponseForExtraction('{"key": "value"}')
    expect(result.isJson).toBe(true)
    expect(result.isXml).toBe(false)
    expect(result.parsed).toEqual({ key: 'value' })
  })

  it('detects XML', () => {
    const result = parseResponseForExtraction('<?xml version="1.0"?><root></root>')
    expect(result.isXml).toBe(true)
    expect(result.isJson).toBe(false)
  })

  it('detects HTML as XML-like', () => {
    const result = parseResponseForExtraction('<html><body></body></html>')
    expect(result.isXml).toBe(true)
  })

  it('returns raw text for non-JSON non-XML', () => {
    const result = parseResponseForExtraction('plain text')
    expect(result.isJson).toBe(false)
    expect(result.isXml).toBe(false)
    expect(result.parsed).toBe('plain text')
  })

  it('handles empty string', () => {
    const result = parseResponseForExtraction('')
    expect(result.isJson).toBe(false)
    expect(result.isXml).toBe(false)
  })
})

describe('extractValueFromResponse', () => {
  it('extracts value from JSON response', () => {
    const result = extractValueFromResponse('{"token":"abc123"}', 'token')
    expect(result.value).toBe('abc123')
    expect(result.error).toBeUndefined()
  })

  it('returns error for XML response with path', () => {
    const result = extractValueFromResponse('<xml><data>val</data></xml>', 'data')
    expect(result.error).toContain('XML')
  })

  it('returns raw body for JSON response with empty path', () => {
    const result = extractValueFromResponse('{"key":"val"}', '')
    expect(result.value).toBe('{"key":"val"}')
  })

  it('returns error for non-JSON response with path', () => {
    const result = extractValueFromResponse('not json', 'key')
    expect(result.error).toContain('Non-JSON response')
  })
})
