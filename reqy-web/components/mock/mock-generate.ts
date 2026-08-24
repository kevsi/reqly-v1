"use client";

/**
 * Génération headless d'une config de mock par l'IA (mode simple de la page
 * Mock). Réutilise le client cloud-engine existant (`streamLLM`) avec un seul
 * outil forcé : `validate_mock_config`. Le modèle doit produire une config et
 * la faire valider par le vrai validateur du moteur ; en cas d'erreurs, les
 * résultats sont renvoyés au modèle via `previousTurns` pour correction.
 * Aucune écriture : la config validée est retournée à l'UI, qui l'applique
 * uniquement sur clic explicite.
 */
import type { MockConfig } from "@reqly/mock-engine";
import { loadAIProvider, loadApiKey, loadAiBaseUrl, loadAiModel, loadOllamaConfig } from "@/lib/config";
import { getMockDraft } from "./mock-draft-bridge";
import { handleValidateMockConfig } from "@/lib/mock/mock-ai-tools";
import type { ToolCall, ToolResult } from "@/lib/llm-tools";
import { streamLLM } from "@/src/ai/cloud-engine/llm";

const SYSTEM_PROMPT = `Tu génères des configurations pour Reqly Mock Server (moteur HTTP local).
Réponds en appelant l'outil validate_mock_config avec une config complète valide. Pas de prose avant/après.

Schéma strict :
{ "version": 1, "name"?: string, "port"?: number, "cors": true, "basePath"?: string,
  "routes": [{ "id": slug-unique, "method": "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS",
    "path": "/api/ressources/:id" (suffixe "*splat" supporté),
    "responses": [{ "id": string, "statusCode": number, "headers"?: {"content-type":"application/json"},
      "body": string-JSON }] }] }

Règles :
- body est TOUJOURS une chaîne contenant du JSON sérialisé (JSON.stringify), réaliste (3+ champs).
- ids en kebab-case stables ("get-users", "get-users-r2").
- Couvre le CRUD demandé + les codes d'erreur utiles (404 sur /:id, 400 sur POST invalide si pertinent).
- Latence/pannes/stateful uniquement si explicitement demandés:
  latency {minMs,maxMs}, failure {probability 0..1, kind}, stateful {enabled:true}.
- port: garde celui fourni dans le contexte s'il existe, sinon 4015.`;

const MAX_ATTEMPTS = 3;

export interface MockGenerateResult {
  config: MockConfig;
  summary: string;
}

interface Turn {
  assistantToolCalls: ToolCall[];
  toolResults: ToolResult[];
}

function buildUserMessage(description: string): string {
  const draft = getMockDraft();
  const context =
    draft?.port != null || draft?.name
      ? `\nContexte brouillon actuel: name=${draft?.name ?? "?"} port=${draft?.port ?? "?"}.`
      : "";
  return `Demande du développeur:\n${description.trim()}${context}`;
}

/** Extrait la config depuis les arguments bruts du tool call du modèle. */
function extractConfig(call: ToolCall): unknown | null {
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    if (parsed && typeof parsed === "object") {
      const cfg = (parsed as Record<string, unknown>).config;
      if (cfg && typeof cfg === "object") return cfg;
      return parsed;
    }
  } catch {
    /* arguments malformés */
  }
  return null;
}

export class MockGenerateConfigError extends Error {}

export async function generateMockConfig(
  description: string,
  signal?: AbortSignal,
): Promise<MockGenerateResult> {  const provider = loadAIProvider();
  if (!provider) throw new MockGenerateConfigError("Configure ton provider IA dans Réglages.");
  const apiKey = provider === "ollama" ? "" : (loadApiKey(provider) ?? "");
  const model = loadAiModel(provider) || undefined;
  const openaiUrl =
    provider === "openai" || provider === "custom" || provider === "grok"
      ? loadAiBaseUrl(provider) || undefined
      : undefined;
  const ollamaConfig = loadOllamaConfig();
  if (provider !== "ollama" && !apiKey.trim()) {
    throw new MockGenerateConfigError("Clé API manquante dans Réglages.");
  }

  const rawMessage = buildUserMessage(description);
  const turns: Turn[] = [];
  let lastValidatorMessage = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let calls: ToolCall[] | null = null;
    for await (const token of streamLLM({
      provider,
      apiKey: apiKey.trim(),
      model,
      openaiUrl,
      host: provider === "ollama" ? ollamaConfig.host : undefined,
      port: provider === "ollama" ? ollamaConfig.port : undefined,
      system: SYSTEM_PROMPT,
      rawMessage,
      tools: [
        {
          name: "validate_mock_config",
          description:
            "Soumet la config complète générée. Retourne valid=true ou la liste des problèmes à corriger.",
          parameters: {
            config: {
              type: "object",
              description:
                "Config mock complète: {version:1, cors:true, routes:[{id, method, path, responses:[{id, statusCode, headers?, body}]}], ...}",
              required: true,
            },
          },
        },
      ],
      tool_choice: "auto",
      previousTurns: turns.length > 0 ? turns : undefined,
      signal,
    })) {
      if (token.type === "tool_calls") {
        calls = token.calls;
      }
    }

    const call = calls?.find((c) => c.name === "validate_mock_config");
    if (!call) {
      throw new MockGenerateConfigError(
        "Le modèle n'a pas produit de configuration (pas d'appel d'outil). Réessaie.",
      );
    }

    const rawConfig = extractConfig(call);
    const result = await handleValidateMockConfig({ config: rawConfig });
    if (!result.error) {
      const clean = rawConfig as MockConfig;
      return {
        config: clean,
        summary: summarize(clean, result.content),
      };
    }

    // Validation échouée → retour au modèle avec le message du validateur.
    turns.push({
      assistantToolCalls: calls ?? [],
      toolResults: [result],
    });
    lastValidatorMessage = result.content;
  }

  throw new MockGenerateConfigError(
    `Config toujours invalide après ${MAX_ATTEMPTS} tentatives. Dernier retour du validateur : ${lastValidatorMessage.slice(0, 300)}`,
  );
}

function summarize(config: MockConfig, validatorContent: string): string {
  try {
    const parsed = JSON.parse(validatorContent) as { routes?: string[] };
    if (Array.isArray(parsed.routes)) return parsed.routes.join(" · ");
  } catch {
    /* ignore */
  }
  return `${config.routes.length} routes`;
}
