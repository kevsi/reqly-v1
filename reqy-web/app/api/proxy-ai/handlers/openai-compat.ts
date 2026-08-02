import { NextResponse } from "next/server";
import { structuredError } from "../lib/errors";
import { passthroughSSE } from "../lib/sse";
import { getCustomUrl } from "../lib/url-utils";
import { buildOpenAIToolHistory } from "../lib/tool-history";
import type { PreviousTurn } from "../lib/tool-history";

export interface OpenAICompatBody {
  provider: string;
  apiKey?: string;
  model?: string;
  system?: string;
  message?: string;
  stream?: boolean;
  tools?: Record<string, unknown>[];
  tool_choice?: string | Record<string, unknown>;
  previousTurns?: PreviousTurn[];
  openaiUrl?: string;
}

export interface ExtraOptions {
  signal?: AbortSignal;
}

function getEndpoint(provider: string, body: Record<string, unknown>): string | Promise<string> {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "opencode-zen":
      return "https://opencode.ai/zen/v1/chat/completions";
    case "grok":
      return "https://api.x.ai/v1/chat/completions";
    case "custom":
      return getCustomUrl(body);
    default:
      return "https://api.openai.com/v1/chat/completions";
  }
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "openrouter":
      return "openai/gpt-5.2";
    case "opencode-zen":
      return "gpt-5";
    case "grok":
      return "grok-2";
    default:
      return "gpt-4o-mini";
  }
}

export async function handleOpenAICompat(
  body: OpenAICompatBody & Record<string, unknown>,
  extra: ExtraOptions,
): Promise<NextResponse> {
  const apiKey = body.apiKey ?? "";
  const model = body.model ?? getDefaultModel(body.provider);
  const system = body.system ?? "";
  const message = body.message ?? "";
  const tools = Array.isArray(body.tools) ? (body.tools as Record<string, unknown>[]) : undefined;
  const toolChoice = body.tool_choice as string | Record<string, unknown> | undefined;
  const previousTurns = body.previousTurns as PreviousTurn[] | undefined;

  if (!apiKey) {
    return structuredError("Missing API key", "MISSING_API_KEY", 400);
  }

  if (!message) {
    return structuredError("Missing message", "MISSING_MESSAGE", 400);
  }

  let url: string;
  try {
    url = await getEndpoint(body.provider, body);
  } catch (err: any) {
    return structuredError(err?.message ?? "Invalid provider URL", "INVALID_PROVIDER_URL", 400);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: extra.signal,
    body: JSON.stringify({
      model,
      stream: Boolean(body.stream),
      ...(body.stream && tools?.length ? { stream_options: { include_usage: true } } : {}),
      ...(tools?.length ? { tools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
        ...buildOpenAIToolHistory(previousTurns),
      ],
    }),
  });

  if (!res.ok) {
    const rawText = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { error: rawText };
    }
    const err =
      data && typeof data === "object" ? (data as Record<string, unknown>).error : undefined;
    return NextResponse.json(
      {
        error:
          typeof err === "string"
            ? err
            : typeof err === "object"
              ? (((err as Record<string, unknown>).message as string) ?? `${body.provider} error`)
              : `${body.provider} error`,
      },
      { status: res.status },
    );
  }

  // Stream passthrough when no tools (no tool_calls to parse)
  if (body.stream && res.body && !tools?.length) return passthroughSSE(res);

  const rawText = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = {};
  }

  // Usage (chunk final du flux stream+tools, sinon data.usage non-stream)
  let usage: Record<string, unknown> | undefined;
  if (body.stream && tools?.length) {
    const usageMatches = rawText.match(/"usage"\s*:\s*\{[^}]*\}/g);
    const last = usageMatches?.[usageMatches.length - 1];
    if (last) {
      try {
        const parsed = JSON.parse(`{${last}}`) as { usage?: Record<string, unknown> };
        if (parsed.usage) usage = parsed.usage;
      } catch {
        /* ignore malformed usage chunk */
      }
    }
  } else if (data && typeof data === "object" && (data as Record<string, unknown>).usage) {
    usage = (data as Record<string, unknown>).usage as Record<string, unknown>;
  }

  const choices =
    data && typeof data === "object" ? (data as Record<string, unknown>).choices : undefined;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : undefined;
  const msg = firstChoice?.message as Record<string, unknown> | undefined;
  const firstText = firstChoice?.text;

  // Extract tool_calls for non-streamed mode
  const rawToolCalls = msg?.tool_calls;
  const toolCalls = Array.isArray(rawToolCalls)
    ? rawToolCalls.map((tc: any) => ({
        id: typeof tc?.id === "string" ? tc.id : `call_${Math.random().toString(36).slice(2)}`,
        name: typeof tc?.function?.name === "string" ? tc.function.name : "",
        arguments: typeof tc?.function?.arguments === "string" ? tc.function.arguments : "{}",
      }))
    : [];

  return NextResponse.json({
    content:
      typeof msg?.content === "string"
        ? msg.content
        : typeof firstText === "string"
          ? firstText
          : "",
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls, provider_tool_format: "openai" } : {}),
    ...(usage ? { usage } : {}),
  });
}
