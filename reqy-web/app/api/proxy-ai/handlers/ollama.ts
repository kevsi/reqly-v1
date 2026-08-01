import { NextResponse } from "next/server";
import { structuredError } from "../lib/errors";
import { passthroughSSE } from "../lib/sse";
import { isOllamaHostAllowed } from "../lib/url-utils";
import { buildOpenAIToolHistory } from "../lib/tool-history";
import type { PreviousTurn } from "../lib/tool-history";

export interface OllamaBody {
  provider: string;
  model?: string;
  system?: string;
  message?: string;
  stream?: boolean;
  host?: string;
  port?: string | number;
  tools?: Record<string, unknown>[];
  tool_choice?: string | Record<string, unknown>;
  previousTurns?: PreviousTurn[];
}

export interface ExtraOptions {
  signal?: AbortSignal;
}

export async function handleOllama(
  body: OllamaBody & Record<string, unknown>,
  extra: ExtraOptions,
): Promise<NextResponse> {
  const model = body.model || "llama2";
  const system = body.system ?? "";
  const message = body.message ?? "";
  const rawHost = typeof body.host === "string" ? body.host.trim() : "";
  const host = rawHost || "127.0.0.1";
  const tools = Array.isArray(body.tools) ? (body.tools as Record<string, unknown>[]) : undefined;
  const toolChoice = body.tool_choice as string | Record<string, unknown> | undefined;
  const previousTurns = body.previousTurns as PreviousTurn[] | undefined;

  const port =
    typeof body.port === "string"
      ? body.port.trim()
      : typeof body.port === "number"
        ? String(body.port)
        : "";
  const ollamaPort = port || process.env.OLLAMA_PORT || "11434";

  // SSRF check
  if (!(await isOllamaHostAllowed(host))) {
    return structuredError(
      "Invalid host: localhost and private IPs are not allowed",
      "SSRF_BLOCKED",
      403,
    );
  }

  const res = await fetch(`http://${host}:${ollamaPort}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
    redirect: "manual",
    signal: extra.signal,
    body: JSON.stringify({
      model,
      stream: Boolean(body.stream),
      ...(tools?.length ? { tools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
        ...buildOpenAIToolHistory(previousTurns),
      ],
    }),
  });

  // Streaming passthrough
  if (body.stream && res.body) return passthroughSSE(res);

  // Non-streaming: parse JSON response
  const data: unknown = await res.json();
  if (!res.ok) {
    const err =
      data && typeof data === "object" ? (data as Record<string, unknown>).error : undefined;
    return NextResponse.json(
      { error: typeof err === "string" ? err : "Ollama error" },
      { status: res.status },
    );
  }
  const choices =
    data && typeof data === "object" ? (data as Record<string, unknown>).choices : undefined;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : undefined;
  const msg = firstChoice?.message as Record<string, unknown> | undefined;
  const content = typeof msg?.content === "string" ? msg.content : "";
  return NextResponse.json({ content });
}
