"use client";

/**
 * askAIText — completion texte unique pour les helpers IA hors-chat
 * (correction d'assertions, runner "Demander à l'IA", simple-mode).
 *
 * Unification v1→v2 (analyse 2026-09-03) : les consommateurs historiques
 * passaient par `useAIEngine().sendMessage(prompt, ACTIONS_SYSTEM_PROMPT, ctx)`
 * — le protocole JSON-actions legacy (parseAIResponse + dispatchAIActions),
 * qui n'a de sens que si l'on veut DISPATCHER des actions. Pour une
 * completion texte pure (la réponse est lue, pas exécutée), le chemin
 * correct est l'appel texte direct du cloud-engine, sans protocole
 * d'actions, sans dispatcher, sans double système de garde-fous.
 */

import { callAITextViaStream } from "@/src/ai/cloud-engine/text";
import { resolveAiConfig } from "@/lib/ai-config";
import type { AIContext } from "@/src/ai/cloud-engine/actions";

/** Résume un AIContext en texte injecté avant la question. */
export function summarizeContext(ctx?: AIContext | null): string {
  if (!ctx?.currentRequest) return "";
  const c = ctx.currentRequest;
  const lines = [
    `Requête courante : ${c.method ?? "?"} ${c.url ?? "?"}`,
  ];
  if (c.body) lines.push(`Body (extrait) : ${String(c.body).slice(0, 800)}`);
  const last = ctx.lastResponse;
  if (last) {
    lines.push(`Dernière réponse : status ${last.status ?? "?"}`);
    if (last.body) lines.push(`Corps (extrait) : ${String(last.body).slice(0, 1200)}`);
  }
  return lines.join("\n");
}

/**
 * Envoie un prompt en completion texte (non-streamée côté appelant) et
 * renvoie le texte de l'assistant. Sans tools, sans dispatch : le résultat
 * est destiné à être AFFICHÉ ou PARCÉ par l'appelant.
 *
 * @throws Error si l'IA n'est pas configurée ou si l'appel échoue.
 */
export async function askAIText(
  prompt: string,
  options?: { context?: AIContext | null; system?: string },
): Promise<string> {
  const config = resolveAiConfig();
  if (!config) {
    throw new Error("IA non configurée — ajoutez une clé API ou Ollama dans Settings → AI.");
  }

  const contextBlock = summarizeContext(options?.context);
  const fullPrompt = contextBlock ? `${contextBlock}\n\n${prompt}` : prompt;

  const text = await callAITextViaStream({
    provider: config.provider,
    apiKey: config.apiKey ?? "",
    model: config.model,
    openaiUrl: config.openaiUrl,
    host: config.host,
    port: config.port,
    system:
      options?.system ??
      "Tu es l'assistant Reqly. Réponds de façon concise et factuelle, en français.",
    rawMessage: fullPrompt,
  });
  return text;
}
