import { NextResponse } from "next/server";
import { structuredError } from "../lib/errors";
import { buildAnthropicToolHistory } from "../lib/tool-history";
import type { PreviousTurn } from "../lib/tool-history";

export interface AnthropicBody {
  provider: string;
  apiKey?: string;
  model?: string;
  system?: string;
  message?: string;
  tools?: Record<string, unknown>[];
  previousTurns?: PreviousTurn[];
}

export interface ExtraOptions {
  signal?: AbortSignal;
}

export async function handleAnthropic(
  body: AnthropicBody & Record<string, unknown>,
  extra: ExtraOptions,
): Promise<NextResponse> {
  const apiKey = body.apiKey ?? "";
  const model = body.model || "claude-sonnet-4-20250514";
  const system = body.system ?? "";
  const message = body.message ?? "";
  const tools = Array.isArray(body.tools) ? (body.tools as Record<string, unknown>[]) : undefined;
  const previousTurns = body.previousTurns as PreviousTurn[] | undefined;

  if (!apiKey) {
    return structuredError("Missing API key", "MISSING_API_KEY", 400);
  }

  if (!message) {
    return structuredError("Missing message", "MISSING_MESSAGE", 400);
  }

  // Convert OpenAI-style tools to Anthropic format
  const anthropicTools = tools?.map((t) => {
    const fn = (t as any).function ?? t;
    return {
      name: fn.name,
      description: fn.description,
      input_schema: fn.parameters ?? fn.input_schema ?? {},
    };
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: extra.signal,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: message }, ...buildAnthropicToolHistory(previousTurns)],
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    }),
  });

  const data: unknown = await res.json();
  if (!res.ok) {
    const err =
      data && typeof data === "object" ? (data as Record<string, unknown>).error : undefined;
    return NextResponse.json(
      {
        error:
          typeof err === "string"
            ? err
            : typeof err === "object"
              ? (((err as Record<string, unknown>).message as string) ?? "Anthropic error")
              : "Anthropic error",
      },
      { status: res.status },
    );
  }

  // Format unifié: extract text and tool_use blocks
  const contentData =
    data && typeof data === "object" ? (data as Record<string, unknown>).content : undefined;
  const contentArray = Array.isArray(contentData) ? contentData : [];
  const textContent = contentArray
    .filter(
      (item: unknown): item is { type?: string; text?: string } =>
        typeof item === "object" && item !== null,
    )
    .reduce((acc: string, item) => (item.type === "text" ? acc + (item.text || "") : acc), "");

  const toolUses = contentArray
    .filter(
      (
        item: unknown,
      ): item is {
        type?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      } => typeof item === "object" && item !== null && (item as any).type === "tool_use",
    )
    .map((item) => ({
      id: (item as any).id,
      name: (item as any).name,
      arguments: JSON.stringify((item as any).input ?? {}),
    }));

  if (toolUses.length > 0) {
    return NextResponse.json({
      content: textContent,
      tool_calls: toolUses,
      provider_tool_format: "anthropic" as const,
      stop_reason: (data as Record<string, unknown>).stop_reason,
    });
  }

  return NextResponse.json({ content: textContent });
}
