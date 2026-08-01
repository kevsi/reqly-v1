export type PreviousTurn = {
  assistantToolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolResults: Array<{
    callId: string;
    name: string;
    content: string;
    error?: string;
  }>;
};

export type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }>; text?: string };
    text?: string;
  }>;
  text?: string;
};

export function buildOpenAIToolHistory(prev?: PreviousTurn[]): Record<string, unknown>[] {
  if (!prev || prev.length === 0) return [];
  const msgs: Record<string, unknown>[] = [];
  for (const turn of prev) {
    msgs.push({
      role: "assistant",
      content: null,
      tool_calls: turn.assistantToolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });
    for (const r of turn.toolResults) {
      msgs.push({
        role: "tool",
        tool_call_id: r.callId,
        content: r.error ?? r.content,
      });
    }
  }
  return msgs;
}

export function buildAnthropicToolHistory(prev?: PreviousTurn[]): Record<string, unknown>[] {
  if (!prev || prev.length === 0) return [];
  const msgs: Record<string, unknown>[] = [];
  for (const turn of prev) {
    msgs.push({
      role: "assistant",
      content: turn.assistantToolCalls.map((tc) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          /* ignore */
        }
        return { type: "tool_use", id: tc.id, name: tc.name, input };
      }),
    });
    msgs.push({
      role: "user",
      content: turn.toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.callId,
        content: r.error ?? r.content,
      })),
    });
  }
  return msgs;
}

export function buildGeminiToolHistory(prev?: PreviousTurn[]): Record<string, unknown>[] {
  if (!prev || prev.length === 0) return [];
  const contents: Record<string, unknown>[] = [];
  for (const turn of prev) {
    contents.push({
      role: "model",
      parts: turn.assistantToolCalls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          /* ignore */
        }
        return { functionCall: { name: tc.name, args } };
      }),
    });
    for (const r of turn.toolResults) {
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: r.name,
              response: { content: r.error ?? r.content },
            },
          },
        ],
      });
    }
  }
  return contents;
}

export function tryParseGeminiError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message ?? parsed.error ?? raw;
  } catch {
    return raw;
  }
}
