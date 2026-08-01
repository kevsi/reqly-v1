const COOKIE_KEY = "postman_api_key"
const COOKIE_USER = "postman_user"
const DURATION_S = 30 * 24 * 60 * 60

function cookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURATION_S,
  }
}

export function buildApiKeyCookie(value: string) {
  return { name: COOKIE_KEY, value, ...cookieOpts() }
}

export function buildUserCookie(user: { username: string; email?: string }) {
  return { name: COOKIE_USER, value: JSON.stringify(user), ...cookieOpts() }
}

export function buildClearCookies() {
  return [
    { name: COOKIE_KEY, value: "", ...cookieOpts(), maxAge: 0 },
    { name: COOKIE_USER, value: "", ...cookieOpts(), maxAge: 0 },
  ]
}

export function getApiKeyFromRequest(request: { cookies: { get(name: string): { value: string } | undefined } }): string | null {
  return request.cookies.get(COOKIE_KEY)?.value ?? null
}

export function getUserFromRequest(request: { cookies: { get(name: string): { value: string } | undefined } }): { username: string; email?: string } | null {
  const raw = request.cookies.get(COOKIE_USER)?.value
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
