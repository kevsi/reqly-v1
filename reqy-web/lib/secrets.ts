/**
 * Secure secrets management with caching
 *
 * For production deployments, use AWS Secrets Manager or similar.
 * This module provides a consistent interface for retrieving secrets
 * with automatic caching and rotation support.
 *
 * Environment variables:
 *   - AUTH_SIGNING_SECRET: JWT signing secret (32+ chars)
 *   - PROXY_SERVICE_TOKEN: Service token for proxy endpoints (32+ chars)
 *
 * 🔐 SECURITY:
 *   - Never log secrets
 *   - Cache secrets in memory for 12 hours to reduce API calls
 *   - Secrets should NOT be passed as build args (visible in docker history)
 *   - Use runtime environment injection instead
 */

interface CachedSecret {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CachedSecret>();

// 12 hours = 12 * 60 * 60 * 1000 milliseconds
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Retrieve a secret from environment variables with caching
 *
 * Logs an error if the secret is missing but does not throw,
 * allowing the application to continue (e.g., in development).
 *
 * @param name - Secret name (e.g., 'AUTH_SIGNING_SECRET')
 * @param minLength - Minimum secret length (default: 32)
 * @returns The secret value, or empty string if not found or invalid
 */
export function getSecret(name: string, minLength: number = 32): string {
  const now = Date.now();

  // Check cache first
  const cached = cache.get(name);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  // Read from environment
  const value = process.env[name] ?? "";

  // Validate length
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[SECURITY] Missing required secret: ${name}`);
    } else {
      console.warn(`[DEV] Secret ${name} not configured. Using empty string.`);
    }
    return "";
  }

  if (value.length < minLength) {
    console.error(`[SECURITY] Secret ${name} is too short (< ${minLength} chars)`);
    return "";
  }

  // Cache the secret
  cache.set(name, {
    value,
    expiresAt: now + CACHE_TTL_MS,
  });

  return value;
}

/**
 * Rotate a secret in the cache
 * Call this after updating a secret in AWS Secrets Manager or similar
 */
export function invalidateSecret(name: string): void {
  cache.delete(name);
}

/**
 * Clear all cached secrets
 * Useful for testing or force-rotation
 */
export function clearSecrets(): void {
  cache.clear();
}

/**
 * Get AUTH_SIGNING_SECRET for JWT operations
 */
export function getAuthSigningSecret(): string {
  return getSecret("AUTH_SIGNING_SECRET", 32);
}

/**
 * Get PROXY_SERVICE_TOKEN for internal service authentication
 */
export function getProxyServiceToken(): string {
  return getSecret("PROXY_SERVICE_TOKEN", 32);
}

/**
 * Check if all required secrets are configured
 * Returns false in development (to allow dev without all secrets)
 * Returns true in production only if all secrets are properly set
 */
export function areSecretsConfigured(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true; // Dev can run without all secrets
  }

  const authSecret = getSecret("AUTH_SIGNING_SECRET", 32);
  const proxyToken = getSecret("PROXY_SERVICE_TOKEN", 32);

  return !!(authSecret && proxyToken);
}
