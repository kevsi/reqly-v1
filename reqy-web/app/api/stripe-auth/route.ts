export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { buildApiKeyCookie, buildClearCookies } from "./cookies";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const STRIPE_BALANCE_URL = "https://api.stripe.com/v1/balance";
const API_KEY_REGEX = /^(sk_test|sk_live|rk_test|rk_live|whsec)_[A-Za-z0-9]+$/;

export async function POST(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey || !API_KEY_REGEX.test(apiKey)) {
    return NextResponse.json(
      {
        error:
          "Clé API Stripe invalide (doit commencer par sk_test_, rk_test_, sk_live_ ou rk_live_)",
      },
      { status: 400 },
    );
  }

  // Verify the key by calling Stripe's balance endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const stripeRes = await fetch(STRIPE_BALANCE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!stripeRes.ok) {
      const error = await stripeRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: error.error?.message ?? "Clé API Stripe invalide" },
        { status: 400 },
      );
    }

    const data = await stripeRes.json();
    const response = NextResponse.json({
      connected: true,
      user: {
        livemode: data.livemode,
        // Stripe balance endpoint returns available + pending amounts
        currency: Object.keys(data.available?.[0] ?? {})[0] ?? "usd",
      },
    });
    response.cookies.set(buildApiKeyCookie(apiKey));
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json({ error: "Timeout lors de la validation Stripe" }, { status: 504 });
    }
    return NextResponse.json({ error: "Erreur inattendue" }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  for (const cookie of buildClearCookies()) {
    response.cookies.set(cookie);
  }
  return response;
}
