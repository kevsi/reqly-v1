import { NextResponse } from "next/server";
import { structuredError } from "../lib/errors";
import { buildGeminiToolHistory, tryParseGeminiError } from "../lib/tool-history";
import type { PreviousTurn, GeminiChunk } from "../lib/tool-history";

export interface GeminiBody {
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

interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
}

interface GeminiCandidateExt {
  content?: { parts?: Array<{ text?: string }>; text?: string };
  text?: string;
  functionCall?: GeminiFunctionCall;
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Convert OpenAI-style tools to Gemini format
  const geminiTools = tools?.length
    ? [
        {
          functionDeclarations: tools.map((t) => {
            const fn = (t as any).function ?? t;
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

  // Handle SSE streaming response
  if (contentType.includes("text/event-stream")) {
    const rawText = await res.text();
    let combined = "";
    const functionCallCalls: Array<{
      id?: string;
      name?: string;
      arguments: string;
    }> = [];

    for (const line of rawText.split("\n")) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const chunk: GeminiChunk & {
            candidates?: Array<GeminiCandidateExt>;
          } = JSON.parse(jsonStr);
          const text =
            chunk.candidates?.[0]?.content?.parts?.[0]?.text ||
            chunk.candidates?.[0]?.content?.text ||
            chunk.text ||
            "";
          if (text) combined += text;

          const fc = chunk.candidates?.[0]?.functionCall;
          if (fc?.name) {
            functionCallCalls.push({
              id: fc.id,
              name: fc.name,
              arguments: JSON.stringify(fc.args ?? {}),
            });
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    if (!res.ok && !combined && functionCallCalls.length === 0) {
      const errData = tryParseGeminiError(rawText);
      return NextResponse.json({ error: errData }, { status: res.status });
    }

    if (functionCallCalls.length > 0) {
      return NextResponse.json({
        content: combined,
        tool_calls: functionCallCalls,
        provider_tool_format: "gemini" as const,
      });
    }

    return NextResponse.json({ content: combined });
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

  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  const firstCandidate =
    Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : undefined;
  const candidateContent = firstCandidate?.content as Record<string, unknown> | undefined;
  const parts = candidateContent?.parts as Array<Record<string, unknown>> | undefined;
  const firstPart = Array.isArray(parts) && parts.length > 0 ? parts[0] : undefined;
  const content = (firstPart?.text as string) ?? (candidateContent?.text as string) ?? "";

  // Detect functionCall in non-streamed response
  const functionCall = firstCandidate?.functionCall as GeminiFunctionCall | undefined;
  if (functionCall?.name) {
    return NextResponse.json({
      content,
      tool_calls: [
        {
          id: functionCall.id,
          name: functionCall.name,
          arguments: JSON.stringify(functionCall.args ?? {}),
        },
      ],
      provider_tool_format: "gemini" as const,
    });
  }

  return NextResponse.json({ content });
}
