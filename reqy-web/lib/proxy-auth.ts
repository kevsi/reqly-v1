export function getProxyToken(): string {
  if (typeof window !== "undefined") {
    // Browser: Next.js inlines NEXT_PUBLIC_* env vars at build time.
    // Must match PROXY_SERVICE_TOKEN (server-side) or proxy.ts answers 401.
    return (process.env as Record<string, string | undefined>).NEXT_PUBLIC_PROXY_SERVICE_TOKEN || ""
  }
  try {
    return (process.env as Record<string, string | undefined>).PROXY_SERVICE_TOKEN || ""
  } catch {
    return ""
  }
}

export function proxyAuthHeaders(): Record<string, string> {
  const token = getProxyToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}
