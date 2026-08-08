// Client-side token for the sidecar proxy gate. The token is issued per
// visitor by `reqy-web/proxy.ts` as the `proxy_visitor` cookie and read here
// at runtime — it is never a static NEXT_PUBLIC_* var, so it is not inlined
// in the client bundle and cannot be extracted by cross-site pages.
const VISITOR_COOKIE = "proxy_visitor";

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function getProxyToken(): string {
  if (typeof window !== "undefined") {
    return readCookie(VISITOR_COOKIE);
  }
  try {
    return (process.env as Record<string, string | undefined>).PROXY_SERVICE_TOKEN || "";
  } catch {
    return "";
  }
}

export function proxyAuthHeaders(): Record<string, string> {
  const token = getProxyToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
