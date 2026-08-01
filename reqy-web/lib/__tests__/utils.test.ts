import { describe, it, expect } from 'vitest'
import { interpolate, hasUnresolvedPlaceholders, replaceLocalhostPort } from '@/lib/utils'

describe('interpolate', () => {
  it('replaces {{key}} with variable value', () => {
    const result = interpolate('Hello {{name}}!', [{ key: 'name', value: 'World', enabled: true }])
    expect(result).toBe('Hello World!')
  })

  it('replaces {{ key }} with spaces', () => {
    const result = interpolate('Hello {{ name }}!', [{ key: 'name', value: 'World', enabled: true }])
    expect(result).toBe('Hello World!')
  })

  it('replaces multiple occurrences', () => {
    const result = interpolate('{{a}}-{{a}}-{{b}}', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ])
    expect(result).toBe('1-1-2')
  })

  it('replaces multiple distinct variables', () => {
    const result = interpolate('{{host}}/api/{{version}}', [
      { key: 'host', value: 'example.com', enabled: true },
      { key: 'version', value: 'v2', enabled: true },
    ])
    expect(result).toBe('example.com/api/v2')
  })

  it('ignores disabled variables', () => {
    const result = interpolate('{{key}}', [{ key: 'key', value: 'val', enabled: false }])
    expect(result).toBe('{{key}}')
  })

  it('handles regex special characters in key', () => {
    const result = interpolate('{{$token}} and {{api+key}}', [
      { key: '$token', value: 'abc', enabled: true },
      { key: 'api+key', value: 'xyz', enabled: true },
    ])
    expect(result).toBe('abc and xyz')
  })

  it('handles empty text', () => {
    expect(interpolate('', [])).toBe('')
    expect(interpolate(undefined as unknown as string, [])).toBe(undefined as unknown as string)
  })

  it('handles no variables', () => {
    expect(interpolate('plain text', [])).toBe('plain text')
  })

  it('leaves unresolved placeholders intact', () => {
    const result = interpolate('{{missing}}', [{ key: 'other', value: 'val', enabled: true }])
    expect(result).toBe('{{missing}}')
  })
})

describe('hasUnresolvedPlaceholders', () => {
  it('detects {{placeholder}}', () => {
    expect(hasUnresolvedPlaceholders('{{key}}')).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(hasUnresolvedPlaceholders('hello world')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasUnresolvedPlaceholders('')).toBe(false)
  })

  it('detects nested braces', () => {
    expect(hasUnresolvedPlaceholders('{{user.id}}')).toBe(true)
  })
})

describe('replaceLocalhostPort', () => {
  it('replaces port in localhost URL', () => {
    expect(replaceLocalhostPort('http://localhost:3000/api/test', 8080)).toBe('http://localhost:8080/api/test')
  })

  it('returns unchanged if no localhost port', () => {
    expect(replaceLocalhostPort('https://example.com/api', 8080)).toBe('https://example.com/api')
  })

  it('handles empty string', () => {
    expect(replaceLocalhostPort('', 8080)).toBe('')
  })
})
