export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { rateLimiter, getRateLimitKey } from "./lib/rate-limit";
import { structuredError } from "./lib/errors";
import { handleOpenAICompat } from "./handlers/openai-compat";
import { handleAnthropic } from "./handlers/anthropic";
import { handleGemini } from "./handlers/gemini";
import { handleDeepSeek } from "./handlers/deepseek";
import { handleOllama } from "./handlers/ollama";

const SUPPORTED_PROVIDERS = new Set([
  "openai",
  "openrouter",
  "opencode-zen",
  "custom",
  "grok",
  "anthropic",
  "gemini",
  "deepseek",
  "ollama",
]);

const PROVIDERS_WITH_API_KEY = new Set([
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
  "deepseek",
  "opencode-zen",
  "custom",
  "grok",
]);

const MAX_PREVIOUS_TURNS = 5;
const MAX_PREVIOUS_TURNS_BYTES = 200 * 1024;

export async function POST(req: NextRequest) {
  const rateKey = getRateLimitKey(req);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return structuredError("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", 429);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return structuredError("Invalid JSON in request body", "INVALID_JSON", 400);
  }

  if (typeof rawBody !== "object" || rawBody === null) {
    return structuredError("Body must be a JSON object", "INVALID_PAYLOAD", 400);
  }

  const body = rawBody as Record<string, unknown>;
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";

  if (!provider) {
    return structuredError("Missing provider", "MISSING_PROVIDER", 400);
  }

  const previousTurns = Array.isArray(body.previousTurns) ? body.previousTurns : [];
  if (previousTurns.length > MAX_PREVIOUS_TURNS) {
    return structuredError(
      `Too many previous turns: maximum allowed is ${MAX_PREVIOUS_TURNS}`,
      "TOO_MANY_PREVIOUS_TURNS",
      400,
    );
  }
  const totalTurnsBytes = previousTurns.reduce(
    (sum, turn) => sum + (typeof turn.content === "string" ? turn.content.length : 0),
    0,
  );
  if (totalTurnsBytes > MAX_PREVIOUS_TURNS_BYTES) {
    return structuredError(
      `Previous turns exceed maximum size of ${MAX_PREVIOUS_TURNS_BYTES} bytes`,
      "PREVIOUS_TURNS_TOO_LARGE",
      413,
    );
  }

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return structuredError("Unknown provider", "UNKNOWN_PROVIDER", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message && provider !== "ollama") {
    return structuredError("Missing message", "MISSING_MESSAGE", 400);
  }

  if (PROVIDERS_WITH_API_KEY.has(provider)) {
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      return structuredError("Missing API key", "MISSING_API_KEY", 400);
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const extra = { signal: controller.signal };

    let response: NextResponse;

    switch (provider) {
      case "anthropic":
        response = await handleAnthropic(body as Parameters<typeof handleAnthropic>[0], extra);
        break;
      case "gemini":
        response = await handleGemini(body as Parameters<typeof handleGemini>[0], extra);
        break;
      case "deepseek":
        response = await handleDeepSeek(body as Parameters<typeof handleDeepSeek>[0], extra);
        break;
      case "ollama":
        response = await handleOllama(body as Parameters<typeof handleOllama>[0], extra);
        break;
      // openai, openrouter, opencode-zen, custom, grok
      default:
        response = await handleOpenAICompat(
          body as Parameters<typeof handleOpenAICompat>[0],
          extra,
        );
        break;
    }

    clearTimeout(timeout);
    return response;
  } catch (err) {
    // Never echo the raw error: upstream errors can embed internal hostnames,
    // paths and connection details. Return a generic message, keep the cause
    // in the server logs.
    console.error("[proxy-ai] upstream error:", err);
    return NextResponse.json({ error: "AI provider request failed" }, { status: 500 });
  }
}
