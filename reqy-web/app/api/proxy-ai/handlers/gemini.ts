import { NextResponse } from "next/server";
import { structuredError } from "../lib/errors";
import { buildGeminiToolHistory, tryParseGeminiError } from "../lib/tool-history";
import type { PreviousTurn } from "../lib/tool-history";

export interface GeminiBody {
  provider: string;
  apiKey?: string;
  model?: string;
  system?: string;
  message?: string;
  /** Same streaming request flag as openai-compat.ts. */
  stream?: boolean;
  tools?: Record<string, unknown>[];
  previousTurns?: PreviousTurn[];
}

export interface ExtraOptions {
  signal?: AbortSignal;
}

interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
}

interface GeminiPartExt {
  text?: string;
  functionCall?: GeminiFunctionCall;
}

interface GeminiCandidateExt {
  content?: { parts?: GeminiPartExt[] };
}

interface GeminiExtracted {
  content: string;
  toolCalls: Array<{ id?: string; name: string; arguments: string }>;
}

function mapGeminiUsage(m: Record<string, unknown> | undefined) {
  if (!m || typeof m !== "object") return undefined;
  const input_tokens = Number(m.promptTokenCount ?? 0);
  const output_tokens = Number(m.candidatesTokenCount ?? 0);
  if (input_tokens === 0 && output_tokens === 0) return undefined;
  return { input_tokens, output_tokens };
}

// The real Gemini API nests everything under candidates[*].content.parts[]:
// text arrives as { text } parts and tool invocations as
// { functionCall: { name, args } } parts. A single response can mix several
// text fragments and emit multiple function calls in one turn, so collect ALL
// of them.
function extractGeminiParts(candidates: GeminiCandidateExt[] | undefined): GeminiExtracted {
  const extracted: GeminiExtracted = { content: "", toolCalls: [] };
  if (!candidates) return extracted;
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part.text === "string") {
        extracted.content += part.text;
      } else if (part.functionCall?.name) {
        const { name, args, id } = part.functionCall;
        extracted.toolCalls.push({
          ...(typeof id === "string" ? { id } : {}),
          name,
          arguments: JSON.stringify(args ?? {}),
        });
      }
    }
  }
  return extracted;
}

// Single response contract for both paths (plain JSON and aggregated SSE):
// { content, tool_calls?, provider_tool_format?, usage? } — exactly the shape
// src/ai/cloud-engine/llm.ts parses in its JSON fallback branch.
function buildGeminiResponse(
  extracted: GeminiExtracted,
  usage: ReturnType<typeof mapGeminiUsage>,
): NextResponse {
  if (extracted.toolCalls.length > 0) {
    return NextResponse.json({
      content: extracted.content,
      tool_calls: extracted.toolCalls,
      provider_tool_format: "gemini" as const,
      ...(usage ? { usage } : {}),
    });
  }

  return NextResponse.json({
    content: extracted.content,
    ...(usage ? { usage } : {}),
  });
}

export async function handleGemini(
  body: GeminiBody & Record<string, unknown>,
  extra: ExtraOptions,
): Promise<NextResponse> {
  const apiKey = body.apiKey ?? "";
  const model = body.model || "gemini-2.0-flash";
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

  // :generateContent never streams. When the client asks for streaming,
  // hit the SSE endpoint instead and aggregate the chunks below.
  const wantsStream = Boolean(body.stream);
  const method = wantsStream ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;

  // Convert OpenAI-style tools to Gemini format
  const geminiTools = tools?.length
    ? [
        {
          functionDeclarations: tools.map((t) => {
            const fn: Record<string, unknown> =
              (t as { function?: Record<string, unknown> }).function ?? t;
            return {
              name: fn.name,
              description: fn.description,
              parameters: fn.parameters ?? {},
            };
          }),
        },
      ]
    : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    signal: extra.signal,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: message }] }, ...buildGeminiToolHistory(previousTurns)],
      ...(geminiTools?.length ? { tools: geminiTools } : {}),
    }),
  });

  const contentType = res.headers.get("content-type") || "";

  // Handle SSE streaming response (chunks share the candidates/content/parts
  // shape; they are aggregated into a single JSON payload for the client).
  if (contentType.includes("text/event-stream")) {
    const rawText = await res.text();
    let usageMetadata: Record<string, unknown> | undefined;
    const chunkCandidates: GeminiCandidateExt[][] = [];

    for (const line of rawText.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const chunk: {
          candidates?: GeminiCandidateExt[];
          usageMetadata?: Record<string, unknown>;
        } = JSON.parse(jsonStr);
        if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
        if (chunk.candidates?.length) chunkCandidates.push(chunk.candidates);
      } catch {
        // skip malformed chunks
      }
    }

    const extracted = extractGeminiParts(chunkCandidates.flat());

    if (!res.ok && !extracted.content && extracted.toolCalls.length === 0) {
      const errData = tryParseGeminiError(rawText);
      return NextResponse.json({ error: errData }, { status: res.status });
    }

    return buildGeminiResponse(extracted, mapGeminiUsage(usageMetadata));
  }

  // Non-streaming JSON response
  const rawText = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = {};
  }

  if (!res.ok) {
    const err = data.error;
    const errMsg =
      typeof err === "string"
        ? err
        : err && typeof err === "object"
          ? (((err as Record<string, unknown>).message as string) ?? tryParseGeminiError(rawText))
          : (tryParseGeminiError(rawText) ?? "Gemini error");
    return NextResponse.json({ error: errMsg }, { status: res.status });
  }

  const promptFeedback = data.promptFeedback as Record<string, unknown> | undefined;
  if (promptFeedback?.blockReason) {
    return NextResponse.json({
      content: "",
      blocked: true,
      reason: promptFeedback.blockReason,
    });
  }

  const candidates = data.candidates as GeminiCandidateExt[] | undefined;
  const extracted = extractGeminiParts(candidates);

  return buildGeminiResponse(
    extracted,
    mapGeminiUsage(data.usageMetadata as Record<string, unknown> | undefined),
  );
}
