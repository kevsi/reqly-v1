/**
 * Cloud engine — adaptateur texte mono-shot.
 *
 * Les consommateurs du flux « un prompt → un texte » (chats, GraphQL,
 * propose-correction…) font des appels sans streaming ni tool-calling.
 * `streamLLM` est un AsyncIterable de tokens ; cet adaptateur en fait une
 * promesse de texte complet, avec les mêmes options.
 *
 * Deux modes :
 * - `rawMessage` : prompt utilisateur envoyé tel quel, SANS le wrapper de
 *   contexte `buildUserPrompt` (équivalent de l'ancien `callAIText` du
 *   moteur legacy, désormais supprimé). Utilisé par les consommateurs
 *   migrés dont les prompts sont autonomes (chats, GraphQL,
 *   propose-correction…).
 * - `question` + `ctx` : mode natif cloud-engine (prompt wrappé avec le
 *   contexte de requête + RAG).
 *
 * Règles :
 * - Accumule uniquement les tokens `text` (usage / tool_calls ignorés).
 * - Erreurs du provider propagées telles quelles (throw) — pas d'avalement.
 * - Un `signal` d'abandon est accepté et transmis à `streamLLM`.
 */
import { streamLLM, type StreamLLMOptions } from "./llm";
import type { RequestContext } from "@/src/ai/types";

export type CallAITextViaStreamOptions = Omit<
  StreamLLMOptions,
  "tools" | "tool_choice" | "previousTurns" | "question" | "ctx" | "rawMessage"
> & {
  /** Prompt brut envoyé tel quel (mode migration legacy). */
  rawMessage?: string;
  /** Question + contexte wrappé par buildUserPrompt (mode natif). */
  question?: string;
  ctx?: RequestContext;
};

/** Contexte minimal vide pour les appels texte sans contexte de requête. */
function emptyContext(): RequestContext {
  return {
    request: { method: "GET", url: "", headers: {}, body: undefined, authType: "none" },
    timestamp: Date.now(),
  };
}

/** Valeurs par défaut Ollama, alignées sur la config legacy (127.0.0.1:11434). */
function ollamaDefaults(
  provider: string,
  host?: string,
  port?: number | string,
): { host?: string; port?: number | string } {
  if (provider !== "ollama") return { host, port };
  return { host: host || "127.0.0.1", port: port ?? 11434 };
}

/**
 * Appel texte mono-shot : interroge le provider via `streamLLM` et accumule
 * les tokens texte en une seule chaîne. Équivalent fonctionnel de l'ancien
 * `callAIText` du moteur legacy, mais branché sur le cloud-engine.
 */
export async function callAITextViaStream(
  opts: CallAITextViaStreamOptions,
): Promise<string> {
  if (!opts.rawMessage && !opts.question) {
    throw new Error("callAITextViaStream: rawMessage ou question requis");
  }
  const { host, port } = ollamaDefaults(opts.provider, opts.host, opts.port);
  let fullText = "";
  for await (const token of streamLLM({
    ...opts,
    host,
    port,
    // streamLLM requiert question/ctx dans son type ; on les déduit ici.
    question: opts.rawMessage ?? opts.question ?? "",
    ctx: opts.ctx ?? emptyContext(),
    rawMessage: opts.rawMessage,
  })) {
    if (token.type === "text") fullText += token.value;
    // usage / tool_calls ignorés : contrat mono-shot texte
  }
  return fullText;
}
