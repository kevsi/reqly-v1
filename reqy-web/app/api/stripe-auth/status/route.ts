export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getApiKeyFromRequest } from "../cookies";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const apiKey = getApiKeyFromRequest(request);
  if (!apiKey) {
    return NextResponse.json({ connected: false });
  }

  // Verify the key is still valid
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const stripeRes = await fetch("https://api.stripe.com/v1/balance", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!stripeRes.ok) {
      const response = NextResponse.json({ connected: false });
      for (const cookie of [{ name: "stripe_api_key", value: "", maxAge: 0, path: "/" }]) {
        response.cookies.set(cookie);
      }
      return response;
    }

    const data = await stripeRes.json();
    return NextResponse.json({
      connected: true,
      user: {
        livemode: data.livemode,
        currency: Object.keys(data.available?.[0] ?? {})[0] ?? "usd",
      },
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
