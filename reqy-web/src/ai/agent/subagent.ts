import { streamLLM } from "@/src/ai/cloud-engine/llm";
import type { AIProvider } from "@/src/ai/types";

export const MAX_DELEGATE_DEPTH = 1;

export interface SubAgentOptions {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  openaiUrl?: string;
  host?: string;
  port?: number | string;
  role: string;
  instruction: string;
  context: string;
  signal?: AbortSignal;
  depth?: number;
}

export interface SubAgentResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Garde-fou anti-récursion — deux couches cohérentes :
 *  - assertDelegationAllowed(depthCourant) : bloque un APPELANT déjà au max
 *    (le sous-agent, qui reçoit depth=1, est bloqué ici s'il tente delegate) ;
 *  - assertSpawnAllowed(nouvelleProfondeur) : la CRÉATION d'un sous-agent à
 *    cette profondeur reste dans la limite (principal depth 0 → spawn 1 : ok). */
export function assertDelegationAllowed(depth: number): void {
  if (depth >= MAX_DELEGATE_DEPTH) {
    throw new Error(
      `Profondeur de délégation maximale atteinte (${MAX_DELEGATE_DEPTH}). Un sous-agent ne peut pas déléguer à nouveau.`,
    );
  }
}

export function assertSpawnAllowed(newDepth: number): void {
  if (newDepth > MAX_DELEGATE_DEPTH) {
    throw new Error(
      `Profondeur de délégation maximale dépassée (${newDepth} > ${MAX_DELEGATE_DEPTH}).`,
    );
  }
}

export async function runSubAgent(opts: SubAgentOptions): Promise<SubAgentResult> {
  // FIX : on vérifie que la NOUVELLE profondeur reste dans la limite.
  // L'ancien code réutilisait assertDelegationAllowed sur la valeur DÉJÀ
  // incrémentée par les handlers (0+1=1 ≥ 1) → toute délégation échouait,
  // y compris depuis l'agent principal.
  assertSpawnAllowed(opts.depth ?? 0);

  const prompt = `${opts.instruction}\n\nContexte:\n${opts.context}`;
  let text = "";
  const usage = { inputTokens: 0, outputTokens: 0 };

  for await (const t of streamLLM({
    provider: opts.provider,
    apiKey: opts.apiKey,
    model: opts.model,
    openaiUrl: opts.openaiUrl,
    host: opts.host,
    port: opts.port,
    system: opts.role,
    question: prompt,
    ctx: {
      request: { method: "GET", url: "", headers: {}, body: undefined, authType: "none" },
      timestamp: Date.now(),
    },
    signal: opts.signal,
  })) {
    if (t.type === "text") text += t.value;
    else if (t.type === "usage") {
      usage.inputTokens += t.usage.inputTokens;
      usage.outputTokens += t.usage.outputTokens;
    }
  }

  return { text: text.trim(), usage };
}
