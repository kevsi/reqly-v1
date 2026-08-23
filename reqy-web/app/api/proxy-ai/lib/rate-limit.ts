import { createRateLimiter } from "@/lib/rate-limiter";
import type { NextRequest } from "next/server";

export const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
});

const TRUSTED_PROXY = (): boolean => process.env.TRUSTED_PROXY === "true";

export function getRateLimitKey(request: NextRequest): string {
  const cookieStore = (
    request as unknown as {
      cookies?: { get: (name: string) => { value?: string } | undefined };
    }
  ).cookies;
  const visitor = cookieStore?.get("proxy_visitor")?.value;
  if (visitor) return `visitor:${visitor}`;

  const headers = (
    request as unknown as {
      headers?: { get: (name: string) => string | null };
    }
  ).headers;
  const getHeader = (name: string): string | null => headers?.get?.(name) ?? null;

  if (TRUSTED_PROXY()) {
    const forwarded = getHeader("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || getHeader("x-real-ip");
    if (ip) return `ip:${ip}`;
  }

  // AWS load balancers and CloudFront expose the client address through the
  // standard forwarding headers when the deployment trusts that proxy chain.
  const directIp = getHeader("cloudfront-viewer-address") || getHeader("x-real-ip");
  if (directIp) return `ip:${directIp.trim()}`;

  // The visitor cookie is normally created by proxy.ts; this fallback keeps
  // non-browser callers from sharing the old literal `unknown` bucket.
  const userAgent = getHeader("user-agent")?.slice(0, 160) || "no-user-agent";
  return `anonymous:${userAgent}`;
}
