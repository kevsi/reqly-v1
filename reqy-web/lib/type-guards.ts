/**
 * Type Guards — Replacing `as any` assertions with proper type narrowing
 * 
 * These type guards enable TypeScript to narrow types safely without
 * bypassing the type system. Use these throughout the codebase instead of
 * unsafe `as any` assertions.
 */

/**
 * Check if a value is a record/object (not null, not array)
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Check if an object has a specific property with a given type
 */
export function hasProperty<K extends string, V = unknown>(
  obj: unknown,
  key: K,
  typeGuard?: (v: unknown) => v is V
): obj is Record<K, V> {
  if (!isRecord(obj) || !(key in obj)) {
    return false
  }
  return typeGuard ? typeGuard(obj[key]) : true
}

/**
 * Check if an object is a valid proxy payload
 */
export function isProxyPayload(
  v: unknown
): v is {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
  debug?: boolean
  workspaceId?: string
} {
  if (!isRecord(v)) return false

  const url = v.url
  const method = v.method
  const headers = v.headers
  const body = v.body
  const timeout = v.timeout
  const debug = v.debug
  const workspaceId = v.workspaceId

  // Optional fields: check type only if present
  if (url !== undefined && typeof url !== 'string') return false
  if (method !== undefined && typeof method !== 'string') return false
  if (headers !== undefined && !isRecord(headers)) return false
  if (body !== undefined && typeof body !== 'string') return false
  if (timeout !== undefined && typeof timeout !== 'number') return false
  if (debug !== undefined && typeof debug !== 'boolean') return false
  if (workspaceId !== undefined && typeof workspaceId !== 'string') return false

  return true
}

/**
 * Check if a value is a boolean
 */
export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

/**
 * Check if a value is a string
 */
export function isString(v: unknown): v is string {
  return typeof v === 'string'
}

/**
 * Check if a value is a number
 */
export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v)
}

/**
 * Check if a value is an array
 */
export function isArray<T = unknown>(v: unknown, itemGuard?: (item: unknown) => item is T): v is T[] {
  if (!Array.isArray(v)) return false
  return itemGuard ? v.every(itemGuard) : true
}

/**
 * Check if a value is a valid HTTP method
 */
export function isHttpMethod(v: unknown): v is 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' {
  return isString(v) && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(v)
}

/**
 * Check if a value is a valid auth type
 */
export function isAuthType(v: unknown): v is 'none' | 'bearer' | 'basic' | 'api-key' | 'oauth2' {
  return isString(v) && ['none', 'bearer', 'basic', 'api-key', 'oauth2'].includes(v)
}

/**
 * Safe string conversion with fallback
 */
export function toString(v: unknown, fallback = ''): string {
  if (isString(v)) return v
  if (v === null || v === undefined) return fallback
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v) || fallback
}

/**
 * Safe URL validation
 */
export function isValidUrl(v: unknown): v is string {
  if (!isString(v)) return false
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
}
