import { z } from "zod";
import type { HistoryItem } from "@/lib/types";

import type { AIProvider } from "@/lib/types";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { isTauriAvailable } from "@/lib/tauri";
import { callAiProxyTauri } from "@/lib/tauri-ai";
import { maskSensitivePayload } from "@/src/ai/cloud-engine/prompt";
export const generatedRequestSchema = z.object({
  name: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().min(1),
  endpoint: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  queryParams: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  rationale: z.string().optional(),
  /**
   * Optional Postman-style assertions the AI suggests to validate the
   * follow-up request. Each item is a { code, label } pair using the
   * pm.test(...) / pm.response.* JavaScript DSL. The handler converts
   * them to both legacy (`assertions`) and runner (`runnerAssertions`)
   * formats so they show up in the Tests and Assertions tabs.
   */
  assertions: z
    .array(
      z.object({
        code: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  /** Optional JS executed before the request is sent (uses the pm.* sandbox). */
  preRequestScript: z.string().optional(),
  /** Optional JS executed after the response is received (uses the pm.* sandbox). */
  postResponseScript: z.string().optional(),
});

export type GeneratedRequest = z.infer<typeof generatedRequestSchema>;

export function buildFollowUpPrompt(item: HistoryItem): string {
  let responsePreview: string;
  if (item.responseBody instanceof Blob) {
    responsePreview = "[binary data]";
  } else if (item.responseBody && item.responseBody.length > 6000) {
    responsePreview = escapeXml(`${item.responseBody.slice(0, 6000)}\n…(truncated)`);
  } else {
    responsePreview = escapeXml(String(maskSensitivePayload(item.responseBody || "(empty)")));
  }

  return `You are an API testing assistant. Based on the HTTP request and response below, propose ONE logical follow-up request (e.g. use a token, fetch a nested resource, paginate, confirm creation).

Return ONLY valid JSON with this shape (all fields after "rationale" are OPTIONAL — include them only if relevant):
{
  "name": "short label",
  "method": "GET|POST|PUT|PATCH|DELETE",
  "url": "full or relative URL",
  "endpoint": "path only if url is absolute",
  "headers": { "Header-Name": "value" },
  "body": "string or empty",
  "queryParams": [{ "key": "k", "value": "v" }],
  "rationale": "one sentence why this follow-up makes sense",
  "assertions": [{ "code": "pm.response.to.have.status(200)", "label": "Status is 200" }],
  "preRequestScript": "optional JS run before send (pm.environment, pm.variables, etc.)",
  "postResponseScript": "optional JS run after response (pm.response.json(), pm.environment.set, etc.)"
}

Original request:
- Method: ${item.method}
- URL: ${item.url}
- Endpoint: ${item.endpoint}
- Headers: ${JSON.stringify(maskSensitivePayload(item.headers ?? {}))}
- Body: ${String(maskSensitivePayload(item.body ?? ""))}

Response:
- Status: ${item.responseStatus ?? "unknown"}
- Time: ${item.responseTime ?? "?"}ms
- Body:
<response_body>
${responsePreview}
</response_body>`;
}

// SECURITY FIX H9: XML escape helper to prevent prompt injection
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function parseGeneratedRequest(text: string): GeneratedRequest | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = generatedRequestSchema.safeParse(parsed);
    if (!result.success) return null;
    const data = result.data;
    return {
      ...data,
      endpoint: data.endpoint || data.url,
    };
  } catch {
    return null;
  }
}

export type AiProxyPayload = {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  openaiUrl?: string;
  host?: string;
  port?: number;
  system: string;
  message: string;
};

export async function callAiProxy(payload: AiProxyPayload): Promise<string> {
  if (isTauriAvailable()) {
    const { content } = await callAiProxyTauri(payload as Record<string, unknown>);
    return content;
  }

  const response = await fetch("/api/proxy-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  const data: { content?: string; error?: string } = (() => {
    try {
      return JSON.parse(rawText);
    } catch {
      return { content: rawText };
    }
  })();

  if (!response.ok) {
    throw new Error(data.error || `AI request failed (${response.status})`);
  }

  return typeof data.content === "string" ? data.content : "";
}

export async function generateFollowUpRequest(
  item: HistoryItem,
  payload: AiProxyPayload,
): Promise<GeneratedRequest> {
  const content = await callAiProxy({
    ...payload,
    system:
      "You output only JSON for API follow-up requests. No markdown fences, no commentary outside the JSON object.",
    message: buildFollowUpPrompt(item),
  });

  const parsed = parseGeneratedRequest(content);
  if (!parsed) {
    throw new Error("L'IA n'a pas renvoyé une requête JSON valide.");
  }
  return parsed;
}
