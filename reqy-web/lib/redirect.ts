const SAFE_REDIRECT = /^\/[a-zA-Z0-9_\-/]*(?:\?[^#]*)?(?:#.*)?$/

/**
 * Validates a redirect path to prevent open-redirect and XSS attacks.
 * Returns the input if it's a safe internal path, otherwise the fallback.
 */
export function safeRedirect(input: string | null | undefined, fallback = "/"): string {
  if (!input) return fallback
  if (input.includes("//") || /^[a-z]+:/i.test(input)) return fallback
  if (!SAFE_REDIRECT.test(input)) return fallback
  return input
}
