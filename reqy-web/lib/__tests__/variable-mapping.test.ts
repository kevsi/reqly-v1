import { describe, it, expect } from 'vitest'
import { resolveMappingValue, resolveMappingValuePipeline, getUnresolvedWarnings, computeDynamicVars } from '@/lib/variable-mapping'
import { detectContentType, isValidJsonPath, extractValueFromResponsePipeline, extractWithRegex, extractValueFromXml } from '@/lib/variable-path'
import type { VariableMapping, HistoryItem } from '@/lib/types'

const createHistoryItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 'hist-1',
  name: 'Test Request',
  method: 'GET',
  url: 'https://api.example.com/test',
  endpoint: '/test',
  headers: {},
  body: '',
  queryParams: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  executedAt: Date.now(),
  responseStatus: 200,
  responseTime: 150,
  responseSize: '1 KB',
  responseBody: '{"data":{"token":"abc123"}}',
  ...overrides,
})

const createMapping = (overrides: Partial<VariableMapping> = {}): VariableMapping => ({
  id: 'map-1',
  name: 'token',
  sourceRequestId: 'hist-1',
  sourcePath: 'data.token',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

describe('resolveMappingValue', () => {
  it('extracts a value from a valid JSON response', () => {
    const history = [createHistoryItem()]
    const mapping = createMapping()
    const result = resolveMappingValue(mapping, history)
    expect(result.value).toBe('abc123')
    expect(result.error).toBeUndefined()
  })

  it('returns error when source request is not found', () => {
    const history: HistoryItem[] = []
    const mapping = createMapping()
    const result = resolveMappingValue(mapping, history)
    expect(result.error).toBe('Source request not found in history.')
  })

  it('returns error when response body is empty', () => {
    const history = [createHistoryItem({ responseBody: '' })]
    const mapping = createMapping()
    const result = resolveMappingValue(mapping, history)
    expect(result.error).toBe('No response recorded for this request.')
  })

  it('returns error when response body is binary (Blob)', () => {
    const history = [createHistoryItem({ responseBody: new Blob(['binary']) as any })]
    const mapping = createMapping()
    const result = resolveMappingValue(mapping, history)
    expect(result.error).toContain('binary')
  })

  it('returns error for non-JSON response with a path', () => {
    const history = [createHistoryItem({ responseBody: 'not json' })]
    const mapping = createMapping()
    const result = resolveMappingValue(mapping, history)
    expect(result.error).toContain('Non-JSON response')
  })

  it('returns empty string for non-JSON response with empty path', () => {
    const history = [createHistoryItem({ responseBody: 'raw text' })]
    const mapping = createMapping({ sourcePath: '' })
    const result = resolveMappingValue(mapping, history)
    expect(result.value).toBe('raw text')
    expect(result.error).toBeUndefined()
  })

  it('returns error for invalid path syntax', () => {
    const history = [createHistoryItem()]
    const mapping = createMapping({ sourcePath: 'data!!' })
    const result = resolveMappingValue(mapping, history)
    expect(result.error).toContain('Invalid')
  })

  it('returns error for path not found', () => {
    const history = [createHistoryItem()]
    const mapping = createMapping({ sourcePath: 'data.nonexistent' })
    const result = resolveMappingValue(mapping, history)
    expect(result.error).toContain('Path not found')
  })

  it('supports JSON path with $ prefix', () => {
    const history = [createHistoryItem({ responseBody: '{"id":99}' })]
    const mapping = createMapping({ sourcePath: '$.id' })
    const result = resolveMappingValue(mapping, history)
    expect(result.value).toBe('99')
  })
})

describe('getUnresolvedWarnings', () => {
  it('returns empty array when all mappings resolve', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping()]
    const warnings = getUnresolvedWarnings(mappings, history)
    expect(warnings).toHaveLength(0)
  })

  it('returns warnings for unresolved mappings', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping({ sourcePath: 'data.missing' })]
    const warnings = getUnresolvedWarnings(mappings, history)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('token')
    expect(warnings[0].error).toContain('Path not found')
  })

  it('ignores disabled mappings', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping({ enabled: false, sourcePath: 'data.missing' })]
    const warnings = getUnresolvedWarnings(mappings, history)
    expect(warnings).toHaveLength(0)
  })

  it('ignores mappings with empty names', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping({ name: '   ', sourcePath: 'data.missing' })]
    const warnings = getUnresolvedWarnings(mappings, history)
    expect(warnings).toHaveLength(0)
  })
})

describe('computeDynamicVars', () => {
  it('returns computed variables for resolved mappings', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping()]
    const vars = computeDynamicVars(mappings, history)
    expect(vars).toHaveLength(1)
    expect(vars[0].key).toBe('token')
    expect(vars[0].value).toBe('abc123')
    expect(vars[0].enabled).toBe(true)
  })

  it('returns empty value for unresolved mappings', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping({ sourcePath: 'data.missing' })]
    const vars = computeDynamicVars(mappings, history)
    expect(vars).toHaveLength(1)
    expect(vars[0].value).toBe('')
  })

  it('filters out disabled mappings', () => {
    const history = [createHistoryItem()]
    const mappings = [createMapping({ enabled: false })]
    const vars = computeDynamicVars(mappings, history)
    expect(vars).toHaveLength(0)
  })
})

describe('detectContentType', () => {
  it('returns "json" for a valid JSON object', () => {
    expect(detectContentType('{"a":1}')).toBe('json')
  })

  it('returns "json" for a valid JSON array', () => {
    expect(detectContentType('[1,2,3]')).toBe('json')
  })

  it('returns "xml" for an XML string', () => {
    expect(detectContentType('<root><a>1</a></root>')).toBe('xml')
  })

  it('returns "xml" for an XML declaration', () => {
    expect(detectContentType('<?xml version="1.0"?><root/>')).toBe('xml')
  })

  it('returns "text" for plain text', () => {
    expect(detectContentType('hello world')).toBe('text')
  })

  it('returns "binary" for a Blob', () => {
    expect(detectContentType(new Blob(['x']))).toBe('binary')
  })

  it('returns "unknown" for an empty string', () => {
    expect(detectContentType('')).toBe('unknown')
  })

  it('returns "unknown" for whitespace-only string', () => {
    expect(detectContentType('   \n  ')).toBe('unknown')
  })
})

describe('isValidJsonPath', () => {
  it('returns true for $.user.name', () => {
    expect(isValidJsonPath('$.user.name')).toBe(true)
  })

  it('returns true for $.items[0].id', () => {
    expect(isValidJsonPath('$.items[0].id')).toBe(true)
  })

  it('returns true for $.data[\'key with spaces\']', () => {
    expect(isValidJsonPath("$.data['key with spaces']")).toBe(true)
  })

  it('returns false for ".."', () => {
    expect(isValidJsonPath('..')).toBe(false)
  })

  it('returns false for ".foo"', () => {
    expect(isValidJsonPath('.foo')).toBe(false)
  })

  it('returns false for "[]"', () => {
    expect(isValidJsonPath('[]')).toBe(false)
  })

  it('returns false for "$["', () => {
    expect(isValidJsonPath('$[')).toBe(false)
  })

  it('returns false for "$.foo."', () => {
    expect(isValidJsonPath('$.foo.')).toBe(false)
  })
})

describe('extractValueFromResponsePipeline', () => {
  it('extracts value via JSON path', () => {
    const result = extractValueFromResponsePipeline('{"data":{"token":"abc"}}', '$.data.token')
    expect(result.value).toBe('abc')
    expect(result.error).toBeUndefined()
  })

  it('extracts XML text content via path', () => {
    const xml = '<root><data><token>xyz789</token></data></root>'
    const result = extractValueFromResponsePipeline(xml, 'root.data.token')
    // Either DOMParser or regex fallback should work
    expect(result.value).toBe('xyz789')
    expect(result.error).toBeUndefined()
  })

  it('extracts text using a regex option', () => {
    const body = 'some preamble\ntoken: secret123\nmore text'
    const result = extractValueFromResponsePipeline(body, '', { regex: /token: (.+)/ })
    expect(result.value).toBe('secret123')
    expect(result.error).toBeUndefined()
  })

  it('returns error for a Blob body', () => {
    const result = extractValueFromResponsePipeline(new Blob(['x']), '$.foo')
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/binary|Blob/i)
  })

  it('returns the raw body when path is empty', () => {
    const body = 'plain text content'
    const result = extractValueFromResponsePipeline(body, '')
    expect(result.value).toBe(body)
    expect(result.error).toBeUndefined()
  })

  it('returns error for an invalid path', () => {
    const result = extractValueFromResponsePipeline('{"a":1}', '..')
    expect(result.error).toBeDefined()
  })
})

describe('extractValueFromXml (node fallback)', () => {
  it('extracts nested element text via regex fallback', () => {
    const xml = '<root><data><token>fallback-token</token></data></root>'
    const result = extractValueFromXml(xml, 'root.data.token')
    expect(result.error).toBeUndefined()
    expect(result.value).toBe('fallback-token')
  })

  it('returns error when path is not found', () => {
    const xml = '<root><a>1</a></root>'
    const result = extractValueFromXml(xml, 'root.b')
    expect(result.error).toContain('Path not found')
  })
})

describe('extractWithRegex', () => {
  it('returns capture group 1 when present', () => {
    const result = extractWithRegex('token=abc', /token=(.+)/)
    expect(result.value).toBe('abc')
    expect(result.error).toBeUndefined()
  })

  it('returns full match when no capture group', () => {
    const result = extractWithRegex('hello', /hello/)
    expect(result.value).toBe('hello')
  })

  it('returns error when no match', () => {
    const result = extractWithRegex('abc', /xyz/)
    expect(result.error).toBeDefined()
  })
})

describe('resolveMappingValuePipeline', () => {
  it('returns value for history item with JSON response', () => {
    const history = [createHistoryItem({ responseBody: '{"data":{"token":"abc"}}' })]
    const mapping = createMapping({ sourcePath: '$.data.token' })
    const result = resolveMappingValuePipeline(mapping, history)
    expect(result.value).toBe('abc')
    expect(result.error).toBeUndefined()
  })

  it('returns error when source request is not found', () => {
    const history: HistoryItem[] = []
    const mapping = createMapping()
    const result = resolveMappingValuePipeline(mapping, history)
    expect(result.error).toBe('Source request not found in history.')
  })

  it('returns error when source has Blob body', () => {
    const history = [createHistoryItem({ responseBody: new Blob(['x']) as any })]
    const mapping = createMapping()
    const result = resolveMappingValuePipeline(mapping, history)
    expect(result.error).toMatch(/binary|Blob/i)
  })
})

describe('getUnresolvedWarnings with usePipeline=true', () => {
  it('routes to resolveMappingValuePipeline', () => {
    const history = [createHistoryItem({ responseBody: '{"data":{"token":"abc"}}' })]
    const mappings = [createMapping({ sourcePath: '$.data.token' })]
    const warnings = getUnresolvedWarnings(mappings, history, { usePipeline: true })
    expect(warnings).toHaveLength(0)
  })

  it('produces warnings for unresolved pipeline paths', () => {
    const history = [createHistoryItem({ responseBody: '{"a":1}' })]
    const mappings = [createMapping({ sourcePath: '$.missing.path' })]
    const warnings = getUnresolvedWarnings(mappings, history, { usePipeline: true })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('token')
    expect(warnings[0].error).toBeDefined()
  })
})

describe('computeDynamicVars with usePipeline=true', () => {
  it('routes to resolveMappingValuePipeline', () => {
    const history = [createHistoryItem({ responseBody: '{"data":{"token":"abc"}}' })]
    const mappings = [createMapping({ sourcePath: '$.data.token' })]
    const vars = computeDynamicVars(mappings, history, { usePipeline: true })
    expect(vars).toHaveLength(1)
    expect(vars[0].key).toBe('token')
    expect(vars[0].value).toBe('abc')
    expect(vars[0].enabled).toBe(true)
  })

  it('returns empty value for unresolved pipeline paths', () => {
    const history = [createHistoryItem({ responseBody: '{"a":1}' })]
    const mappings = [createMapping({ sourcePath: '$.nope' })]
    const vars = computeDynamicVars(mappings, history, { usePipeline: true })
    expect(vars).toHaveLength(1)
    expect(vars[0].value).toBe('')
  })
})
