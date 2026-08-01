/**
 * Proxy API Validation Schema
 * 
 * Validates incoming proxy requests with strict type checking.
 */

import { z } from 'zod'

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export const HeadersSchema = z.record(z.string(), z.string()).optional()

export const QueryParamSchema = z.object({
  key: z.string().min(1, 'Query key cannot be empty'),
  value: z.string(),
}).optional()

export const ProxyPayloadSchema = z.object({
  url: z.string().url('Invalid URL').min(1, 'URL is required'),
  method: HttpMethodSchema.default('GET'),
  headers: HeadersSchema,
  body: z.string().optional(),
  queryParams: z.array(QueryParamSchema).optional(),
  timeout: z.number().int().min(100, 'Timeout must be at least 100ms').max(120000, 'Timeout cannot exceed 2 minutes').optional(),
  debug: z.boolean().optional().default(false),
  workspaceId: z.string().optional(),
  sendImmediately: z.boolean().optional().default(false),
}).strict()

export type ProxyPayload = z.infer<typeof ProxyPayloadSchema>

/**
 * Safe proxy payload validator
 * Returns parsed payload or null if invalid, with error logging
 */
export function validateProxyPayload(payload: unknown): ProxyPayload | null {
  try {
    return ProxyPayloadSchema.parse(payload)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      console.error(`[ProxyPayload validation] ${issues}`)
    }
    return null
  }
}

export function validateProxyPayloadThrow(payload: unknown): ProxyPayload {
  try {
    return ProxyPayloadSchema.parse(payload)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      throw new Error(`Invalid proxy payload: ${issues}`, { cause: error })
    }
    throw error
  }
}
