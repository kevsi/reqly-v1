export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getApiKeyFromRequest } from "../jina-auth/cookies";

const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

export async function POST(req: NextRequest) {
  const rateKey = `embed:${req.headers.get("x-forwarded-for") ?? "anonymous"}`;
  const rateResult = await limiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const apiKey = getApiKeyFromRequest(req) ?? process.env.JINA_API_KEY ?? null;
  if (!apiKey) {
    return NextResponse.json({ error: "Jina API key not configured" }, { status: 503 });
  }

  let body: { input?: unknown; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { input, model: inputModel } = body;
  if (!input || (Array.isArray(input) && input.length === 0) || (typeof input === "string" && !input.trim())) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const model = inputModel || "jina-embeddings-v3";
  const inputs = typeof input === "string" ? [input] : input;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: inputs }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `Jina API error ${res.status}: ${errorText}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
      usage?: { total_tokens: number; prompt_tokens: number };
    };

    const embeddings = data.data
      .toSorted((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    return NextResponse.json({ model, embeddings, usage: data.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Embedding request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
