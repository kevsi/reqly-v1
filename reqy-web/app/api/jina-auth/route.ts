export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { buildApiKeyCookie, buildClearCookies } from "./cookies";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getRateLimitKey } from "../proxy-ai/lib/rate-limit";

const JINA_KEY_REGEX = /^jina_[A-Za-z0-9_-]+$/;
const jinaRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
const MAX_BODY_BYTES = 8_192;

async function validateJinaKey(apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "jina-embeddings-v3",
        input: ["test"],
      }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const rate = await jinaRateLimiter.check(getRateLimitKey(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives de connexion Jina. Réessayez plus tard." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corps de requête trop volumineux" }, { status: 413 });
  }
  let body: { apiKey?: string };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Corps de requête trop volumineux" }, { status: 413 });
    }
    body = JSON.parse(rawBody) as { apiKey?: string };
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey || !JINA_KEY_REGEX.test(apiKey)) {
    return NextResponse.json(
      { error: "Clé API invalide (doit commencer par jina_)" },
      { status: 400 },
    );
  }

  const valid = await validateJinaKey(apiKey);
  if (!valid) {
    return NextResponse.json({ error: "Clé API rejetée par Jina" }, { status: 400 });
  }

  const response = NextResponse.json({ connected: true });
  response.cookies.set(buildApiKeyCookie(apiKey));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  for (const cookie of buildClearCookies()) {
    response.cookies.set(cookie);
  }
  return response;
}
