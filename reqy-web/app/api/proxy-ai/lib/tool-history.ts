import { maskSensitivePayload, escapeXml, truncate } from "@/src/ai/cloud-engine/prompt";

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
  /**
   * `reasoning_content` du message assistant (DeepSeek reasoner / thinking).
   * DeepSeek exige de le renvoyer tel quel dans l'historique, sinon HTTP 400
   * « The reasoning_content ... must be passed back to the API ».
   */
  reasoningContent?: string;
};

export type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }>; text?: string };
    text?: string;
  }>;
  text?: string;
};

/**
 * SECURITY FIX: les contenus de tool results proviennent de réponses HTTP
 * externes et sont rejoués au modèle aux tours suivants (injection indirecte
 * possible). Même traitement que le fix H9 de prompt.ts / buildContextSummary :
 * masquage des secrets (maskSensitivePayload), troncature à 2000 chars
 * (truncate, même limite que MAX_BODY_CHARS), échappement XML (escapeXml) et
 * confinement entre délimiteurs <tool_result>. Le résultat reste une string,
 * donc conforme aux schémas openai/deepseek/anthropic/gemini.
 */
function sanitizeToolContent(raw: string): string {
  if (!raw) return "";
  const masked = maskSensitivePayload(raw);
  return `<tool_result>\n${escapeXml(truncate(masked))}\n</tool_result>`;
}

export function buildOpenAIToolHistory(
  prev?: PreviousTurn[],
  opts?: { includeReasoning?: boolean },
): Record<string, unknown>[] {
  if (!prev || prev.length === 0) return [];
  const msgs: Record<string, unknown>[] = [];
  for (const turn of prev) {
    const assistantMsg: Record<string, unknown> = {
      role: "assistant",
      content: null,
      tool_calls: turn.assistantToolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
    // DeepSeek thinking mode exige le round-trip de `reasoning_content` sur le
    // message assistant d'historique. On ne l'ajoute que sur demande (deepseek)
    // pour ne pas exposer le champ à des providers qui le rejetteraient.
    if (opts?.includeReasoning && turn.reasoningContent) {
      assistantMsg.reasoning_content = turn.reasoningContent;
    }
    msgs.push(assistantMsg);
    for (const r of turn.toolResults) {
      msgs.push({
        role: "tool",
        tool_call_id: r.callId,
        content: sanitizeToolContent(r.error ?? r.content),
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
        content: sanitizeToolContent(r.error ?? r.content),
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
              response: { content: sanitizeToolContent(r.error ?? r.content) },
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
