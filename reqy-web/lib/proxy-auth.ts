export function getProxyToken(): string {
  if (typeof window !== "undefined") return ""
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
