import { createRateLimiter } from "@/lib/rate-limiter";
import type { NextRequest } from "next/server";

export const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
});

const TRUSTED_PROXY = (): boolean => process.env.TRUSTED_PROXY === "true";

export function getRateLimitKey(request: NextRequest): string {
  if (TRUSTED_PROXY()) {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
    return ip;
  }
  return "unknown";
}
