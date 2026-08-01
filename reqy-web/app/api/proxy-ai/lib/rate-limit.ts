import { createRateLimiter } from "@/lib/rate-limiter";
import type { NextRequest } from "next/server";

export const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
});

export function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}
