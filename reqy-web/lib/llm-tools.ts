/**
 * Reqly LLM Tools — schéma interne + helpers de conversion par provider.
 *
 * Ce fichier définit :
 * - Le format unifié des tools Reqly (`ToolDefinition`)
 * - Les converters vers OpenAI / Anthropic / Gemini
 * - Un registre d'outils de base, ancrés dans le code Reqly
 * - Le helper d'exécution `executeToolCall`, qui respecte les garde-fous
 *   (confirmations UI, rate limits, masquage des secrets).
 *
 * Règles :
 * - NE JAMAIS exposer une valeur sensible en clair.
 * - NE PAS inventer d'outils qui n'ont pas de handler côté app.
 * - Respecter les confirmations natives ou compenser par une demande explicite.
 */

// ─── Types internes ────────────────────────────────────────────────────────

export type ToolParameterType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParameter {
  type: ToolParameterType;
  description: string;
  enum?: string[];
  required?: boolean;
}

export interface ToolDefinition {
  /** Nom stable, utilisé par le modèle pour appeler l'outil. */
  name: string;
  /** Titre affiché dans l'UI (lisible par l'humain). */
  title: string;
  /** Description humaine et contrainte d'usage. */
  description: string;
  /** Schéma JSON Schema simplifié des paramètres attendus. */
  parameters: Record<string, ToolParameter>;
}

export interface ToolCall {
  /** Identifiant de l'appel fourni par le provider. */
  id: string;
  /** Nom de l'outil demandé. */
  name: string;
  /** Arguments bruts (string JSON) envoyés par le modèle. */
  arguments: string;
}

export interface ToolResult {
  /** Même id que le ToolCall correspondant. */
  callId: string;
  /** Nom de l'outil exécuté. */
  name: string;
  /** Résultat lisible, jamais de données sensibles en clair. */
  content: string;
  /** Si l'exécution a échoué côté app. */
  error?: string;
  /** Si true, l'UI doit demander une confirmation explicite avant exécution. */
  requireConfirmation?: boolean;
  /** Tokens consommés par cet appel (sous-agent), à remonter dans sessionUsage. */
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── Conversions par provider ──────────────────────────────────────────────

/**
 * Convertit un `ToolDefinition` interne vers le format OpenAI-compatible
 * (`tools[]` dans `/v1/chat/completions`).
 */
export function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, param] of Object.entries(tool.parameters)) {
    properties[key] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
    };
    if (param.required) {
      required.push(key);
    }
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      },
    },
  };
}

/**
 * Convertit un `ToolDefinition` interne vers le format Anthropic
 * (`tools[]` dans `/v1/messages`).
 */
export function toAnthropicTool(tool: ToolDefinition): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, param] of Object.entries(tool.parameters)) {
    properties[key] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
    };
    if (param.required) {
      required.push(key);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

/**
 * Convertit un `ToolDefinition` interne vers le format Google Gemini
 * (`tools[].functionDeclarations[]` dans `generateContent`).
 */
export function toGeminiFunctionDeclaration(tool: ToolDefinition): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, param] of Object.entries(tool.parameters)) {
    properties[key] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
    };
    if (param.required) {
      required.push(key);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

// ─── Masquage des valeurs sensibles ────────────────────────────────────────

const SECRET_KEYWORDS = [
  "secret",
  "key",
  "token",
  "password",
  "apikey",
  "api_key",
  "auth",
  "bearer",
  "authorization",
  "cookie",
];

export function maskSensitiveValue(key: string, value: string): string {
  if (typeof value !== "string") return value;
  const lower = key.toLowerCase();
  if (SECRET_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "••••••";
  }
  return value;
}

export function maskSensitiveObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      out[key] = maskSensitiveValue(key, value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = maskSensitiveObject(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ─── Accès au store Reqly ───────────────────────────────────────────────────

import { requestStore } from "@/hooks/use-request-store";
import type { Collection, RequestItem } from "@/hooks/request-types";
import type { HttpMethod } from "@/lib/types";
import { requestItemSchema } from "@/lib/import-schemas";
import type { z } from "zod";
import { safeColor } from "@/lib/collection-utils";

type ImportSchemaRequest = z.infer<typeof requestItemSchema>;
import { maskSensitivePayload } from "@/src/ai/cloud-engine/prompt";
import { runSubAgent, assertDelegationAllowed } from "@/src/ai/agent/subagent";
import { runCollection } from "@/lib/test-runner/runner";
import { createProxyExecutor } from "@/lib/test-runner/proxy-executor";
import type { RunnerContext } from "@/lib/test-runner/types";
import { parseOpenApiSpec, convertToCollections } from "@/lib/openapi-import";
import { parseBrunoCollection, convertBrunoToCollections } from "@/lib/bruno-import";
import { searchIndex } from "@/src/ai/cloud-engine/search-index";
import {
  decodeJwt,
  explainHeader,
  annotateJson,
  summarizeAnnotated,
} from "@/src/ai/cloud-engine/explain";
import { proposeAssertionCorrection } from "@/src/ai/cloud-engine/actions/propose-correction";
import { generateOpenApiSpec } from "@/lib/openapi-export";
import { authorizeToolCall, type ApprovalSource } from "@/src/ai/agent/permissions";
import { MOCK_AI_TOOLS } from "@/lib/mock/mock-ai-tools";
import { CAPTURE_AI_TOOLS } from "@/lib/capture/capture-ai-tools";
import { GIT_AI_TOOLS } from "@/lib/git/git-ai-tools";
import {
  resolveAiConfig,
} from "@/lib/ai-config";
import { getSpecialist, SPECIALIST_IDS } from "@/src/ai/agent/agents";

function findCollectionIdByName(name: string): string | undefined {
  const store = requestStore.getState();
  return store.collections.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id;
}

function findEnvironmentIdByName(name: string): string | undefined {
  const store = requestStore.getState();
  return store.environments.find((e) => e.name.toLowerCase() === name.toLowerCase())?.id;
}

function activeWorkspaceCollections(): Collection[] {
  const store = requestStore.getState();
  const wsId = store.activeWorkspaceId;
  if (!wsId) return store.collections;
  return store.collections.filter((c) => c.workspaceId === wsId);
}

// ─── Outils Reqly ──────────────────────────────────────────────────────────

/**
 * Registre central des outils exposés aux LLMs.
 *
 * Les handlers sont branchés sur le store Zustand (`requestStore`).
 * Les actions destructives retournent `requireConfirmation: true`
 * pour que l'UI demande une confirmation explicite avant exécution.
 */

export interface ToolExecutionOptions {
  confirmed?: boolean;
  /** Profondeur de délégation courante (0 = agent principal). */
  depth?: number;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  options?: ToolExecutionOptions,
) => Promise<ToolResult>;

export interface ReqlyTool extends ToolDefinition {
  handler: ToolHandler;
}

// ─── Handlers safe (read-only) ─────────────────────────────────────────────

async function handleListCollections(_args: Record<string, unknown>): Promise<ToolResult> {
  const collections = activeWorkspaceCollections();
  const names = collections.map((c) => c.name);
  return {
    callId: "",
    name: "list_collections",
    content: JSON.stringify({ collections: names, count: names.length }),
  };
}

async function handleGetRequestContext(_args: Record<string, unknown>): Promise<ToolResult> {
  const store = requestStore.getState();
  const ctx = store.currentRequest;
  const bodyPreview =
    typeof store.lastResponse?.body === "string"
      ? store.lastResponse.body.slice(0, 2000)
      : undefined;
  return {
    callId: "",
    name: "get_request_context",
    content: JSON.stringify({
      method: ctx?.method,
      url: ctx?.url,
      status: store.lastResponse?.status,
      bodyPreview,
    }),
  };
}

// ─── Handlers avec exécution réelle ────────────────────────────────────────

async function handleDelegate(
  args: Record<string, unknown>,
  options?: ToolExecutionOptions,
): Promise<ToolResult> {
  const role = typeof args.role === "string" ? args.role : "Tu es un assistant spécialisé Reqly.";
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  const context = typeof args.context === "string" ? args.context.slice(0, 6000) : "";
  if (!instruction) {
    return { callId: "", name: "delegate", content: "", error: "Le champ instruction est requis." };
  }
  try {
    assertDelegationAllowed(options?.depth ?? 0);
  } catch (e) {
    return {
      callId: "",
      name: "delegate",
      content: "",
      error: e instanceof Error ? e.message : typeof e === "string" ? e : "Délégation refusée.",
    };
  }
  // Config unifiée (même source que la sidebar/le modal) : fallback modèle
  // par défaut inclus — sans lui, un provider fraîchement sélectionné sans
  // modèle sauvegardé envoyait model:undefined au proxy → rejet.
  const cfg = resolveAiConfig();
  if (cfg.provider !== "ollama" && !cfg.apiKey) {
    return {
      callId: "",
      name: "delegate",
      content: "",
      error: "Configure ton provider IA dans Settings.",
    };
  }
  // Registre d'agents : si `agent` est fourni et valide, sa persona remplace
  // le rôle libre. Sinon le rôle libre (ou le défaut) s'applique.
  const agentArg = typeof args.agent === "string" ? getSpecialist(args.agent.trim()) : undefined;
  const effectiveRole = agentArg?.system ?? role;
  const agentLabel = agentArg ? `${agentArg.emoji} ${agentArg.name}` : "Sous-agent";
  try {
    const res = await runSubAgent({
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      model: cfg.model,
      openaiUrl: cfg.openaiUrl,
      host: cfg.host,
      port: cfg.port,
      role: effectiveRole,
      instruction,
      context,
      depth: (options?.depth ?? 0) + 1,
    });
    return {
      callId: "",
      name: "delegate",
      content: `[${agentLabel}]\n${res.text.slice(0, 4000)}`,
      usage: res.usage,
    };
  } catch (e) {
    return {
      callId: "",
      name: "delegate",
      content: "",
      error: e instanceof Error ? e.message : typeof e === "string" ? e : "Le sous-agent a échoué.",
    };
  }
}

/** Nb max d'agents lancés en parallèle par delegate_team (coût/latence bornés). */
const MAX_TEAM_SIZE = 4;
/** Troncature du retour de chaque agent dans la réponse agrégée. */
const TEAM_RESULT_CHARS = 3000;

interface TeamTask {
  agentId?: string;
  instruction: string;
  context?: string;
}

function parseTeamTasks(raw: unknown): TeamTask[] | null {
  if (!Array.isArray(raw)) return null;
  const tasks: TeamTask[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const instruction = typeof o.instruction === "string" ? o.instruction.trim() : "";
    if (!instruction) continue;
    tasks.push({
      agentId: typeof o.agent === "string" && getSpecialist(o.agent) ? o.agent : undefined,
      instruction,
      context: typeof o.context === "string" ? o.context.slice(0, 6000) : undefined,
    });
  }
  return tasks.length > 0 ? tasks.slice(0, MAX_TEAM_SIZE) : null;
}

/**
 * Équipe d'agents en PARALLÈLE : exécute simultanément plusieurs sous-agents
 * du registre (Promise.allSettled — l'échec de l'un n'annule pas les autres)
 * et agrège leurs réponses section par section. Une seule confirmation pour
 * toute l'équipe ; profondeur +1 par tâche (garde anti-récursion inchangé).
 */
async function handleDelegateTeam(
  args: Record<string, unknown>,
  options?: ToolExecutionOptions,
): Promise<ToolResult> {
  const tasks = parseTeamTasks(args.tasks);
  if (!tasks || tasks.length === 0) {
    return {
      callId: "",
      name: "delegate_team",
      content: "",
      error:
        "Aucune tâche valide. Format attendu : tasks:[{agent:\"analyste\"|\"testeur\"|\"securite\"|\"architecte\"|\"optimiseur\", instruction:\"…\", context?}] (1 à 4 tâches).",
    };
  }
  if (tasks.length === 1) {
    return {
      callId: "",
      name: "delegate_team",
      content: "",
      error:
        "Une seule tâche fournie : utilise « Déléguer à un sous-agent » plutôt que l'équipe.",
    };
  }
  try {
    assertDelegationAllowed(options?.depth ?? 0);
  } catch (e) {
    return {
      callId: "",
      name: "delegate_team",
      content: "",
      error: e instanceof Error ? e.message : "Délégation refusée.",
    };
  }

  const cfg = resolveAiConfig();
  if (cfg.provider !== "ollama" && !cfg.apiKey) {
    return {
      callId: "",
      name: "delegate_team",
      content: "",
      error: "Configure ton provider IA dans Settings.",
    };
  }

  // Démarrages décalés (~150 ms) : évite le burst simultané que certains
  // providers saluent d'un 429, tout en conservant l'exécution parallèle.
  const settled = await Promise.all(
    tasks.map(async (task, index) => {
      if (index > 0) await new Promise((r) => setTimeout(r, index * 150));
      const specialist = task.agentId ? getSpecialist(task.agentId) : undefined;
      const label = specialist ? `${specialist.emoji} ${specialist.name}` : "Sous-agent";
      try {
        const res = await runSubAgent({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          model: cfg.model,
          openaiUrl: cfg.openaiUrl,
          host: cfg.host,
          port: cfg.port,
          role: specialist?.system ?? "Tu es un assistant spécialisé Reqly.",
          instruction: task.instruction,
          context: task.context ?? "",
          depth: (options?.depth ?? 0) + 1,
        });
        return { label, ok: true as const, text: res.text, usage: res.usage };
      } catch (e) {
        return {
          label,
          ok: false as const,
          text: e instanceof Error ? e.message : String(e),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    }),
  );

  const sections = settled.map(
    (r) => `[${r.label}] ${r.ok ? "" : "⚠️ échec : "}${r.text.slice(0, TEAM_RESULT_CHARS)}`,
  );
  const failed = settled.filter((r) => !r.ok).length;
  const totalUsage = settled.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  let teamError: string | undefined;
  if (failed > 0) {
    const firstErr = (settled.find((r) => !r.ok)?.text ?? "").slice(0, 200);
    teamError =
      failed === settled.length
        ? `Tous les agents ont échoué — ${firstErr}`
        : `${failed}/${settled.length} agents ont échoué — ${firstErr}`;
  }

  return {
    callId: "",
    name: "delegate_team",
    content: [
      `Équipe de ${settled.length} agents exécutée en parallèle${failed ? ` (${failed} échec${failed > 1 ? "s" : ""})` : ""}.`,
      "",
      ...sections,
    ].join("\n"),
    usage: totalUsage,
    ...(teamError ? { error: teamError } : {}),
  };
}

async function handleCreateCollection(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return {
      callId: "",
      name: "create_collection",
      content: "",
      error: "Le nom de la collection est requis.",
    };
  }

  const store = requestStore.getState();
  const newId = store.addCollection({
    name,
    description: "",
    color: "slate",
    icon: "folder",
    workspaceId: store.activeWorkspaceId ?? "ws-personal",
    requests: [],
    folders: [],
  });

  return {
    callId: "",
    name: "create_collection",
    content: `Collection "${name}" créée avec succès (id: ${newId}).`,
  };
}

async function handleCreateRequest(args: Record<string, unknown>): Promise<ToolResult> {
  const collectionName = typeof args.collection === "string" ? args.collection.trim() : "";
  const method = typeof args.method === "string" ? args.method.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const requestName = typeof args.name === "string" ? args.name.trim() : "";

  if (!collectionName) {
    return {
      callId: "",
      name: "create_request",
      content: "",
      error: "La collection cible est requise.",
    };
  }
  if (!method || !url) {
    return {
      callId: "",
      name: "create_request",
      content: "",
      error: "La méthode et l'URL sont requises.",
    };
  }

  const collectionId = findCollectionIdByName(collectionName);
  if (!collectionId) {
    return {
      callId: "",
      name: "create_request",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  const requestItem: Partial<RequestItem> = {
    name: requestName || `${method} ${url}`,
    method: method as HttpMethod,
    url,
    endpoint: url,
    headers: {},
    body: undefined,
    bodyType: "raw",
    authType: "none",
    authToken: "",
    queryParams: [],
  };

  const newRequestId = requestStore
    .getState()
    .addRequestToCollection(
      collectionId,
      requestItem as Omit<RequestItem, "id" | "createdAt" | "updatedAt">,
    );

  return {
    callId: "",
    name: "create_request",
    content: `Requête ${method} ${url} créée dans "${collectionName}" (id: ${newRequestId}).`,
  };
}

const EXECUTE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const MAX_EXECUTE_BODY_CHARS = 1_000_000;

type ParsedExecuteRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export function parseExecuteRequestArgs(
  args: Record<string, unknown>,
): { value: ParsedExecuteRequest } | { error: string } {
  const method = typeof args.method === "string" ? args.method.trim().toUpperCase() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!method || !url) return { error: "La méthode et l'URL sont requises." };
  if (!EXECUTE_METHODS.has(method)) {
    return { error: "Méthode HTTP non supportée." };
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { error: "URL invalide : protocole HTTP/HTTPS requis." };
    }
  } catch {
    return { error: "URL invalide." };
  }

  const rawHeaders = args.headers;
  const headers: Record<string, string> = {};
  if (rawHeaders !== undefined) {
    if (typeof rawHeaders !== "object" || rawHeaders === null || Array.isArray(rawHeaders)) {
      return { error: "Headers invalides." };
    }
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value !== "string" || /[\r\n]/.test(key) || /[\r\n]/.test(value)) {
        return { error: "Headers invalides." };
      }
      headers[key] = value;
    }
  }

  const rawBody = args.body;
  if (rawBody !== undefined && typeof rawBody !== "string") {
    return { error: "Body invalide." };
  }
  if (typeof rawBody === "string" && rawBody.length > MAX_EXECUTE_BODY_CHARS) {
    return { error: "Body trop volumineux." };
  }
  return { value: { method, url, headers, body: rawBody as string | undefined } };
}

async function handleExecuteRequest(args: Record<string, unknown>): Promise<ToolResult> {
  const parsedArgs = parseExecuteRequestArgs(args);
  if ("error" in parsedArgs) {
    return {
      callId: "",
      name: "execute_request",
      content: "",
      error: parsedArgs.error,
    };
  }
  const { method, url, headers, body } = parsedArgs.value;

  const requestItem: Partial<RequestItem> = {
    name: `${method} ${url}`,
    method: method as HttpMethod,
    url,
    endpoint: url,
    headers,
    body,
    bodyType: body ? "raw" : "raw",
    authType: "none",
    authToken: "",
    queryParams: [],
  };

  try {
    await requestStore.getState().executeRequest(requestItem);
    const store = requestStore.getState();
    const status = store.lastResponse?.status ?? "unknown";
    const duration = store.lastResponse?.durationMs ?? 0;
    const responseBody =
      typeof store.lastResponse?.body === "string"
        ? String(maskSensitivePayload(store.lastResponse.body)).slice(0, 2000)
        : "";

    return {
      callId: "",
      name: "execute_request",
      content: `${method} ${url} → ${status} en ${duration}ms\n${responseBody}`,
    };
  } catch (e) {
    return {
      callId: "",
      name: "execute_request",
      content: "",
      error:
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Erreur lors de l'exécution de la requête.",
    };
  }
}

async function handleRenameCollection(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const newName = typeof args.new_name === "string" ? args.new_name.trim() : "";
  if (!name || !newName) {
    return {
      callId: "",
      name: "rename_collection",
      content: "",
      error: "Le nom actuel et le nouveau nom sont requis.",
    };
  }

  const collectionId = findCollectionIdByName(name);
  if (!collectionId) {
    return {
      callId: "",
      name: "rename_collection",
      content: "",
      error: `Collection "${name}" introuvable.`,
    };
  }

  requestStore.getState().updateCollection(collectionId, { name: newName });

  return {
    callId: "",
    name: "rename_collection",
    content: `Collection "${name}" renommée en "${newName}".`,
  };
}

async function handleDeleteCollection(
  args: Record<string, unknown>,
  options?: { confirmed?: boolean },
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return {
      callId: "",
      name: "delete_collection",
      content: "",
      error: "Le nom de la collection est requis.",
    };
  }

  const collectionId = findCollectionIdByName(name);
  if (!collectionId) {
    return {
      callId: "",
      name: "delete_collection",
      content: "",
      error: `Collection "${name}" introuvable.`,
    };
  }

  if (!options?.confirmed) {
    // Premier appel : demander confirmation
    return {
      callId: "",
      name: "delete_collection",
      content: `Confirmez-vous la suppression de la collection "${name}" ?`,
      requireConfirmation: true,
    };
  }

  // Appel confirmé : exécuter vraiment
  requestStore.getState().deleteCollection(collectionId);
  return {
    callId: "",
    name: "delete_collection",
    content: `Collection "${name}" supprimée.`,
  };
}

async function handleCreateEnvironment(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return {
      callId: "",
      name: "create_environment",
      content: "",
      error: "Le nom de l'environnement est requis.",
    };
  }

  const store = requestStore.getState();
  const envId = requestStore.getState().addEnvironment({
    name,
    color: "slate",
    variables: [],
    workspaceId: store.activeWorkspaceId ?? "ws-personal",
  });

  return {
    callId: "",
    name: "create_environment",
    content: `Environnement "${name}" créé (id: ${envId}).`,
  };
}

async function handleUpdateEnvironmentVariable(args: Record<string, unknown>): Promise<ToolResult> {
  const envName = typeof args.environment === "string" ? args.environment.trim() : "";
  const key = typeof args.key === "string" ? args.key.trim() : "";
  const value = typeof args.value === "string" ? args.value : "";

  if (!envName || !key) {
    return {
      callId: "",
      name: "update_environment_variable",
      content: "",
      error: "L'environnement et la clé sont requis.",
    };
  }

  const envId = findEnvironmentIdByName(envName);
  if (!envId) {
    return {
      callId: "",
      name: "update_environment_variable",
      content: "",
      error: `Environnement "${envName}" introuvable.`,
    };
  }

  const store = requestStore.getState();
  const env = store.environments.find((e) => e.id === envId);
  if (!env) {
    return {
      callId: "",
      name: "update_environment_variable",
      content: "",
      error: `Environnement "${envName}" introuvable.`,
    };
  }

  const variables = [...env.variables];
  const existingIndex = variables.findIndex((v) => v.key.toLowerCase() === key.toLowerCase());

  const newVariable = {
    key,
    value,
    enabled: true,
  };

  if (existingIndex >= 0) {
    variables[existingIndex] = newVariable;
  } else {
    variables.push(newVariable);
  }

  requestStore.getState().updateEnvironment(envId, { variables });

  return {
    callId: "",
    name: "update_environment_variable",
    content:
      existingIndex >= 0
        ? `Variable "${key}" mise à jour dans "${envName}".`
        : `Variable "${key}" ajoutée à "${envName}".`,
  };
}

// ─── Handlers supplémentaires ──────────────────────────────────────────────

async function handleRunCollection(args: Record<string, unknown>): Promise<ToolResult> {
  const collectionName = typeof args.collection === "string" ? args.collection.trim() : "";
  if (!collectionName) {
    return {
      callId: "",
      name: "run_collection",
      content: "",
      error: "Le nom de la collection est requis.",
    };
  }

  const collectionId = findCollectionIdByName(collectionName);
  if (!collectionId) {
    return {
      callId: "",
      name: "run_collection",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  const store = requestStore.getState();
  const collection = store.collections.find((c) => c.id === collectionId);
  if (!collection) {
    return {
      callId: "",
      name: "run_collection",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  if (collection.requests.length === 0) {
    return {
      callId: "",
      name: "run_collection",
      content: `Collection "${collectionName}" est vide.`,
      error: "Aucune requête à exécuter.",
    };
  }

  const executor = createProxyExecutor();

  try {
    const ctx: RunnerContext = {
      environment: store.environmentVariables ?? {},
      iterationData: {},
      iterationIndex: 0,
      log: () => {},
    };
    const report = await runCollection(collection, ctx, {
      executor,
      perRequestTimeoutMs: 30000,
      scriptTimeoutMs: 5000,
      disableScripts: true,
    });

    const lines = report.results.map((r) => {
      const status =
        r.status === "pass"
          ? "[PASS]"
          : r.status === "fail"
            ? "[FAIL]"
            : r.status === "errored"
              ? "[ERROR]"
              : "[SKIP]";
      const code = r.statusCode ? ` (${r.statusCode})` : "";
      const time = r.responseTimeMs ? ` ${r.responseTimeMs}ms` : "";
      return `${status} ${r.requestName}${code}${time}`;
    });

    const summary =
      `Collection "${collectionName}" : ${report.summary.passed}/${report.summary.total} passées en ${report.totalDurationMs}ms\n` +
      lines.join("\n");
    return { callId: "", name: "run_collection", content: summary };
  } catch (e) {
    return {
      callId: "",
      name: "run_collection",
      content: "",
      error: e instanceof Error ? e.message : "Erreur lors de l'exécution de la collection.",
    };
  }
}

async function handleImportCollection(args: Record<string, unknown>): Promise<ToolResult> {
  const format = typeof args.format === "string" ? args.format.trim().toLowerCase() : "";
  const content = typeof args.content === "string" ? args.content.trim() : "";
  const collectionName =
    typeof args.collection_name === "string" ? args.collection_name.trim() : "";

  if (!format || !content) {
    return {
      callId: "",
      name: "import_collection",
      content: "",
      error: "Les champs format et content sont requis.",
    };
  }

  const store = requestStore.getState();
  const wsId = store.activeWorkspaceId ?? "ws-personal";

  try {
    if (format === "openapi") {
      const parsed = parseOpenApiSpec(content);
      if (!parsed.success) {
        return { callId: "", name: "import_collection", content: "", error: parsed.error };
      }
      const collections = convertToCollections(parsed, {
        collectionName: collectionName || parsed.spec.title,
        groupByTag: false,
        baseUrlOverride: undefined,
      });
      let imported = 0;
      for (const col of collections) {
        // Validation Zod : les requêtes invalides (méthode hors enum, champs
        // manquants) sont ignorées au lieu d'être injectées dans le store.
        const requests = col.requests
          .map((r) => requestItemSchema.safeParse({ ...r, method: r.method }))
          .filter((r): r is { success: true; data: ImportSchemaRequest } => r.success)
          .map(({ data }) => ({
            ...data,
            id: `req-${crypto.randomUUID()}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }));
        if (requests.length === 0) continue;
        requestStore.getState().addCollection({
          name: col.name,
          description: col.description ?? "",
          color: safeColor(col.color ?? "emerald"),
          icon: col.icon ?? "package",
          workspaceId: wsId,
          requests,
          folders: [],
        });
        imported++;
      }
      return {
        callId: "",
        name: "import_collection",
        content: `${imported} collection(s) importée(s) depuis OpenAPI.`,
      };
    }

    if (format === "bruno") {
      const parsed = parseBrunoCollection(content);
      if (!parsed.success) {
        return { callId: "", name: "import_collection", content: "", error: parsed.error };
      }
      const collections = convertBrunoToCollections(parsed);
      let imported = 0;
      for (const col of collections) {
        const requests = col.requests
          .map((r) => requestItemSchema.safeParse({ ...r, method: r.method }))
          .filter((r): r is { success: true; data: ImportSchemaRequest } => r.success)
          .map(({ data }) => ({
            ...data,
            id: `req-${crypto.randomUUID()}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }));
        if (requests.length === 0) continue;
        requestStore.getState().addCollection({
          name: col.name,
          description: "",
          color: safeColor(col.color ?? "emerald"),
          icon: col.icon ?? "package",
          workspaceId: wsId,
          requests,
          folders: [],
        });
        imported++;
      }
      return {
        callId: "",
        name: "import_collection",
        content: `${imported} collection(s) importée(s) depuis Bruno.`,
      };
    }

    return {
      callId: "",
      name: "import_collection",
      content: "",
      error: `Format "${format}" non supporté. Utilisez "openapi" ou "bruno".`,
    };
  } catch (e) {
    return {
      callId: "",
      name: "import_collection",
      content: "",
      error: e instanceof Error ? e.message : "Erreur lors de l'import.",
    };
  }
}

async function handleSearchRequests(args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const topK = typeof args.top_k === "number" ? Math.min(args.top_k, 20) : 5;

  if (!query) {
    return {
      callId: "",
      name: "search_requests",
      content: "",
      error: "Le champ query est requis.",
    };
  }

  if (typeof window === "undefined") {
    return {
      callId: "",
      name: "search_requests",
      content: "",
      error: "La recherche sémantique n'est disponible que dans le navigateur.",
    };
  }

  try {
    const results = await searchIndex(query, topK);
    if (results.length === 0) {
      return { callId: "", name: "search_requests", content: "Aucun résultat trouvé." };
    }
    const lines = results.map((r, i) => {
      const item = r.item;
      return `${i + 1}. [${item.method}] ${item.name} (${item.collectionName}) — ${item.url}\n   ${item.text.slice(0, 120)}`;
    });
    return { callId: "", name: "search_requests", content: lines.join("\n") };
  } catch (e) {
    return {
      callId: "",
      name: "search_requests",
      content: "",
      error: e instanceof Error ? e.message : "Erreur lors de la recherche.",
    };
  }
}

async function handleSwitchWorkspace(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!name && !id) {
    return {
      callId: "",
      name: "switch_workspace",
      content: "",
      error: "Le nom ou l'id du workspace est requis.",
    };
  }

  const store = requestStore.getState();
  let targetId = id;

  if (!targetId && name) {
    const workspace = store.workspaces.find((w) => w.name.toLowerCase() === name.toLowerCase());
    if (!workspace) {
      return {
        callId: "",
        name: "switch_workspace",
        content: "",
        error: `Workspace "${name}" introuvable.`,
      };
    }
    targetId = workspace.id;
  }

  if (!targetId) {
    return { callId: "", name: "switch_workspace", content: "", error: "Workspace introuvable." };
  }

  store.setActiveWorkspace?.(targetId);
  const workspace = store.workspaces.find((w) => w.id === targetId);
  return {
    callId: "",
    name: "switch_workspace",
    content: `Workspace activé : "${workspace?.name ?? targetId}".`,
  };
}

async function handleListWorkspaces(_args: Record<string, unknown>): Promise<ToolResult> {
  const store = requestStore.getState();
  const workspaces = store.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    active: w.id === store.activeWorkspaceId,
  }));
  return {
    callId: "",
    name: "list_workspaces",
    content: JSON.stringify({ workspaces, count: workspaces.length }),
  };
}

async function handleGetCurrentWorkspace(_args: Record<string, unknown>): Promise<ToolResult> {
  const store = requestStore.getState();
  const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
  if (!ws) {
    return {
      callId: "",
      name: "get_current_workspace",
      content: "",
      error: "Aucun workspace actif.",
    };
  }
  return {
    callId: "",
    name: "get_current_workspace",
    content: JSON.stringify({
      id: ws.id,
      name: ws.name,
      description: ws.description,
      color: ws.color,
      icon: ws.icon,
      createdAt: ws.createdAt,
      updatedAt: ws.updatedAt,
    }),
  };
}

async function handleGetWorkspace(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";

  const store = requestStore.getState();
  const ws = store.workspaces.find((w) =>
    id ? w.id === id : w.name.toLowerCase() === name.toLowerCase(),
  );
  if (!ws) {
    return {
      callId: "",
      name: "get_workspace",
      content: "",
      error: `Workspace "${name || id}" introuvable.`,
    };
  }

  const collections = store.collections.filter((c) => c.workspaceId === ws.id);
  const totalRequests = collections.reduce((sum, c) => sum + c.requests.length, 0);
  const lastActivity = collections.reduce((max, c) => Math.max(max, c.updatedAt), ws.updatedAt);

  return {
    callId: "",
    name: "get_workspace",
    content: JSON.stringify({
      id: ws.id,
      name: ws.name,
      description: ws.description,
      color: ws.color,
      icon: ws.icon,
      collections_count: collections.length,
      requests_count: totalRequests,
      last_activity: lastActivity,
      created_at: ws.createdAt,
      updated_at: ws.updatedAt,
    }),
  };
}

async function handleSearchWorkspaces(args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";

  const store = requestStore.getState();
  let workspaces = store.workspaces;

  if (query) {
    workspaces = workspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(query) ||
        (w.description && w.description.toLowerCase().includes(query)),
    );
  }

  const results = workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    active: w.id === store.activeWorkspaceId,
  }));

  return {
    callId: "",
    name: "search_workspaces",
    content: JSON.stringify({ workspaces: results, count: results.length }),
  };
}

async function handleDuplicateWorkspace(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!name && !id) {
    return {
      callId: "",
      name: "duplicate_workspace",
      content: "",
      error: "Le nom ou l'id du workspace est requis.",
    };
  }

  const store = requestStore.getState();
  const source = store.workspaces.find((w) =>
    id ? w.id === id : w.name.toLowerCase() === name.toLowerCase(),
  );
  if (!source) {
    return {
      callId: "",
      name: "duplicate_workspace",
      content: "",
      error: `Workspace "${name || id}" introuvable.`,
    };
  }

  const newId = store.duplicateWorkspace?.(source.id);
  if (!newId) {
    return {
      callId: "",
      name: "duplicate_workspace",
      content: "",
      error: "Échec de la duplication.",
    };
  }

  const newWs = store.workspaces.find((w) => w.id === newId);
  return {
    callId: "",
    name: "duplicate_workspace",
    content: `Workspace dupliqué : "${newWs?.name ?? newId}".`,
  };
}

async function handleArchiveWorkspace(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!name && !id) {
    return {
      callId: "",
      name: "archive_workspace",
      content: "",
      error: "Le nom ou l'id du workspace est requis.",
    };
  }

  const store = requestStore.getState();
  const ws = store.workspaces.find((w) =>
    id ? w.id === id : w.name.toLowerCase() === name.toLowerCase(),
  );
  if (!ws) {
    return {
      callId: "",
      name: "archive_workspace",
      content: "",
      error: `Workspace "${name || id}" introuvable.`,
    };
  }

  store.archiveWorkspace?.(ws.id);
  return { callId: "", name: "archive_workspace", content: `Workspace "${ws.name}" archivé.` };
}

async function handleUnarchiveWorkspace(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!name && !id) {
    return {
      callId: "",
      name: "unarchive_workspace",
      content: "",
      error: "Le nom ou l'id du workspace est requis.",
    };
  }

  const store = requestStore.getState();
  const ws = store.workspaces.find((w) =>
    id ? w.id === id : w.name.toLowerCase() === name.toLowerCase(),
  );
  if (!ws) {
    return {
      callId: "",
      name: "unarchive_workspace",
      content: "",
      error: `Workspace "${name || id}" introuvable.`,
    };
  }

  store.unarchiveWorkspace?.(ws.id);
  return { callId: "", name: "unarchive_workspace", content: `Workspace "${ws.name}" désarchivé.` };
}

async function handleGetWorkspaceStats(_args: Record<string, unknown>): Promise<ToolResult> {
  const store = requestStore.getState();
  const wsId = store.activeWorkspaceId;
  if (!wsId) {
    return {
      callId: "",
      name: "get_workspace_stats",
      content: "",
      error: "Aucun workspace actif.",
    };
  }

  const collections = store.collections.filter((c) => c.workspaceId === wsId);
  const totalRequests = collections.reduce((sum, c) => sum + c.requests.length, 0);
  const totalFolders = collections.reduce((sum, c) => sum + (c.folders?.length ?? 0), 0);

  const historyInWs = store.history.filter((h) => {
    const req = store.collections.flatMap((c) => c.requests).find((r) => r.id === h.id);
    return req?.id !== undefined;
  });

  const successCount = historyInWs.filter(
    (h) => (h.responseStatus ?? 0) >= 200 && (h.responseStatus ?? 0) < 300,
  ).length;
  const successRate =
    historyInWs.length > 0 ? Math.round((successCount / historyInWs.length) * 100) : 0;

  return {
    callId: "",
    name: "get_workspace_stats",
    content: JSON.stringify({
      workspace_id: wsId,
      collections: collections.length,
      folders: totalFolders,
      requests: totalRequests,
      history_entries: historyInWs.length,
      success_rate: successRate,
    }),
  };
}

async function handleClearWorkspaceCache(_args: Record<string, unknown>): Promise<ToolResult> {
  const store = requestStore.getState();
  const wsId = store.activeWorkspaceId;
  if (!wsId) {
    return {
      callId: "",
      name: "clear_workspace_cache",
      content: "",
      error: "Aucun workspace actif.",
    };
  }

  const wsCols = store.collections.filter((c) => c.workspaceId === wsId);
  const wsReqIds = new Set(wsCols.flatMap((c) => c.requests.map((r) => r.id)));

  const clearedHistory = store.history.filter((h) => !wsReqIds.has(h.id));
  const removedCount = store.history.length - clearedHistory.length;

  store.clearHistory?.();

  return {
    callId: "",
    name: "clear_workspace_cache",
    content: `Cache vidé : ${removedCount} entrée(s) d'historique supprimée(s) pour le workspace actif.`,
  };
}

async function handleExplainResponse(args: Record<string, unknown>): Promise<ToolResult> {
  const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : "";
  const value = typeof args.value === "string" ? args.value.trim() : "";

  if (!type || !value) {
    return {
      callId: "",
      name: "explain_response",
      content: "",
      error: "Les champs type et value sont requis.",
    };
  }

  try {
    if (type === "jwt") {
      const decoded = decodeJwt(value);
      if (!decoded) {
        return { callId: "", name: "explain_response", content: "", error: "Token JWT invalide." };
      }
      const expInfo = decoded.expiresAt
        ? ` (expiré: ${decoded.expired ? "oui" : "non"}, expires: ${decoded.expiresAt})`
        : "";
      return {
        callId: "",
        name: "explain_response",
        content: `JWT décodé${expInfo}\nHeader: ${JSON.stringify(decoded.header, null, 2)}\nPayload: ${JSON.stringify(decoded.payload, null, 2)}`,
      };
    }

    if (type === "header") {
      const headerName = typeof args.header_name === "string" ? args.header_name.trim() : value;
      const headerValue = typeof args.header_value === "string" ? args.header_value.trim() : "";
      const explanation = explainHeader(headerName, headerValue || value);
      return {
        callId: "",
        name: "explain_response",
        content: `${headerName}: ${explanation.description}\n${explanation.warnings.length > 0 ? "Avertissements: " + explanation.warnings.join(", ") : ""}`,
      };
    }

    if (type === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return { callId: "", name: "explain_response", content: "", error: "JSON invalide." };
      }
      const annotated = annotateJson(parsed);
      const summary = summarizeAnnotated(annotated);
      return {
        callId: "",
        name: "explain_response",
        content: `Structure: ${summary}\n${JSON.stringify(annotated, null, 2).slice(0, 3000)}`,
      };
    }

    return {
      callId: "",
      name: "explain_response",
      content: "",
      error: `Type "${type}" non supporté. Utilisez "jwt", "header" ou "json".`,
    };
  } catch (e) {
    return {
      callId: "",
      name: "explain_response",
      content: "",
      error: e instanceof Error ? e.message : "Erreur lors de l'explication.",
    };
  }
}

async function handleProposeAssertionFix(args: Record<string, unknown>): Promise<ToolResult> {
  const assertionType = typeof args.assertion_type === "string" ? args.assertion_type.trim() : "";
  const target = typeof args.target === "string" ? args.target.trim() : "";
  const actualValue = typeof args.actual_value === "string" ? args.actual_value.trim() : "";
  const expectedValue = typeof args.expected_value === "string" ? args.expected_value.trim() : "";

  if (!assertionType || !target) {
    return {
      callId: "",
      name: "propose_assertion_fix",
      content: "",
      error: "Les champs assertion_type et target sont requis.",
    };
  }

  try {
    const input: import("@/src/ai/cloud-engine/actions/propose-correction").ProposeCorrectionInput =
      {
        assertion: {
          type: assertionType,
          target,
          value: expectedValue || undefined,
        },
        response: {
          status: actualValue
            ? Number(JSON.parse(actualValue).status ?? JSON.parse(actualValue))
            : undefined,
          body: actualValue ? JSON.parse(actualValue) : undefined,
        },
        endpoint: target,
      };

    const result = await proposeAssertionCorrection(input);

    if (!result.suggestion) {
      return {
        callId: "",
        name: "propose_assertion_fix",
        content: "Aucune correction suggérée.",
        error: "La correction n'a pas pu être générée.",
      };
    }

    const suggestion = result.suggestion;
    return {
      callId: "",
      name: "propose_assertion_fix",
      content:
        `Correction suggérée pour ${assertionType} sur "${target}":\n` +
        `Type: ${suggestion.type ?? assertionType}\n` +
        (suggestion.expr ? `Expression: ${suggestion.expr}\n` : "") +
        (suggestion.value !== undefined ? `Valeur: ${JSON.stringify(suggestion.value)}\n` : "") +
        `Rationale: ${result.rationale}`,
    };
  } catch (e) {
    return {
      callId: "",
      name: "propose_assertion_fix",
      content: "",
      error: e instanceof Error ? e.message : "Erreur lors de la proposition de correction.",
    };
  }
}

async function handleExportCollection(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return {
      callId: "",
      name: "export_collection",
      content: "",
      error: "Le nom de la collection est requis.",
    };
  }

  const collectionId = findCollectionIdByName(name);
  if (!collectionId) {
    return {
      callId: "",
      name: "export_collection",
      content: "",
      error: `Collection "${name}" introuvable.`,
    };
  }

  const store = requestStore.getState();
  const collection = store.collections.find((c) => c.id === collectionId);
  if (!collection) {
    return {
      callId: "",
      name: "export_collection",
      content: "",
      error: `Collection "${name}" introuvable.`,
    };
  }

  try {
    const spec = generateOpenApiSpec([collection]);
    return { callId: "", name: "export_collection", content: JSON.stringify(spec, null, 2) };
  } catch (e) {
    return {
      callId: "",
      name: "export_collection",
      content: "",
      error: e instanceof Error ? e.message : "Erreur lors de l'export.",
    };
  }
}

async function handleDuplicateCollection(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return {
      callId: "",
      name: "duplicate_collection",
      content: "",
      error: "Le nom de la collection est requis.",
    };
  }

  const collectionId = findCollectionIdByName(name);
  if (!collectionId) {
    return {
      callId: "",
      name: "duplicate_collection",
      content: "",
      error: `Collection "${name}" introuvable.`,
    };
  }

  requestStore.getState().duplicateCollection(collectionId);
  return { callId: "", name: "duplicate_collection", content: `Collection "${name}" dupliquée.` };
}

async function handleDeleteRequest(args: Record<string, unknown>): Promise<ToolResult> {
  const collectionName = typeof args.collection === "string" ? args.collection.trim() : "";
  const requestName = typeof args.request === "string" ? args.request.trim() : "";

  if (!collectionName || !requestName) {
    return {
      callId: "",
      name: "delete_request",
      content: "",
      error: "Les champs collection et request sont requis.",
    };
  }

  const collectionId = findCollectionIdByName(collectionName);
  if (!collectionId) {
    return {
      callId: "",
      name: "delete_request",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  const store = requestStore.getState();
  const collection = store.collections.find((c) => c.id === collectionId);
  if (!collection) {
    return {
      callId: "",
      name: "delete_request",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  const request = collection.requests.find(
    (r) => r.name.toLowerCase() === requestName.toLowerCase(),
  );
  if (!request) {
    return {
      callId: "",
      name: "delete_request",
      content: "",
      error: `Requête "${requestName}" introuvable dans "${collectionName}".`,
    };
  }

  requestStore.getState().removeRequestFromCollection(collectionId, request.id);
  return {
    callId: "",
    name: "delete_request",
    content: `Requête "${requestName}" supprimée de "${collectionName}".`,
  };
}

async function handleMoveRequest(args: Record<string, unknown>): Promise<ToolResult> {
  const sourceCollection =
    typeof args.source_collection === "string" ? args.source_collection.trim() : "";
  const targetCollection =
    typeof args.target_collection === "string" ? args.target_collection.trim() : "";
  const requestName = typeof args.request === "string" ? args.request.trim() : "";

  if (!sourceCollection || !targetCollection || !requestName) {
    return {
      callId: "",
      name: "move_request",
      content: "",
      error: "Les champs source_collection, target_collection et request sont requis.",
    };
  }

  const sourceId = findCollectionIdByName(sourceCollection);
  const targetId = findCollectionIdByName(targetCollection);
  if (!sourceId || !targetId) {
    return {
      callId: "",
      name: "move_request",
      content: "",
      error: "Collection source ou cible introuvable.",
    };
  }

  const store = requestStore.getState();
  const sourceCol = store.collections.find((c) => c.id === sourceId);
  if (!sourceCol) {
    return {
      callId: "",
      name: "move_request",
      content: "",
      error: `Collection source "${sourceCollection}" introuvable.`,
    };
  }

  const request = sourceCol.requests.find(
    (r) => r.name.toLowerCase() === requestName.toLowerCase(),
  );
  if (!request) {
    return {
      callId: "",
      name: "move_request",
      content: "",
      error: `Requête "${requestName}" introuvable dans "${sourceCollection}".`,
    };
  }

  requestStore.getState().moveRequestBetweenCollections(sourceId, targetId, request.id);
  return {
    callId: "",
    name: "move_request",
    content: `Requête "${requestName}" déplacée de "${sourceCollection}" vers "${targetCollection}".`,
  };
}

async function handleCreateFolder(args: Record<string, unknown>): Promise<ToolResult> {
  const collectionName = typeof args.collection === "string" ? args.collection.trim() : "";
  const folderName = typeof args.name === "string" ? args.name.trim() : "";

  if (!collectionName || !folderName) {
    return {
      callId: "",
      name: "create_folder",
      content: "",
      error: "Les champs collection et name sont requis.",
    };
  }

  const collectionId = findCollectionIdByName(collectionName);
  if (!collectionId) {
    return {
      callId: "",
      name: "create_folder",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  const store = requestStore.getState();
  const collection = store.collections.find((c) => c.id === collectionId);
  if (!collection) {
    return {
      callId: "",
      name: "create_folder",
      content: "",
      error: `Collection "${collectionName}" introuvable.`,
    };
  }

  const newFolder = {
    id: `folder-${crypto.randomUUID()}`,
    name: folderName,
    parentId: null,
    collectionId,
    order: (collection.folders?.length ?? 0) * 1000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  requestStore.getState().updateCollection(collectionId, {
    folders: [...(collection.folders ?? []), newFolder],
  });

  return {
    callId: "",
    name: "create_folder",
    content: `Dossier "${folderName}" créé dans "${collectionName}".`,
  };
}

// ─── Helpers globaux ───────────────────────────────────────────────────────

export function getToolByName(name: string): ReqlyTool | undefined {
  return REQLY_TOOLS.find((t) => t.name === name);
}

/** Titre lisible d'un outil pour l'UI (retombe sur le nom technique). */
export function getToolTitle(name: string): string {
  const tool = REQLY_TOOLS.find((t) => t.name === name);
  return tool?.title ?? name;
}

async function executeToolCall(
  call: ToolCall,
  options?: ToolExecutionOptions | boolean,
): Promise<ToolResult> {
  const tool = getToolByName(call.name);
  if (!tool) {
    return {
      callId: call.id,
      name: call.name,
      content: "",
      error: `Outil inconnu : ${call.name}`,
    };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return {
      callId: call.id,
      name: call.name,
      content: "",
      error: "Arguments JSON invalides.",
    };
  }

  const opts: ToolExecutionOptions =
    typeof options === "boolean" ? { confirmed: options } : (options ?? {});

  try {
    const result = await tool.handler(args, opts);
    return { ...result, callId: call.id };
  } catch (e) {
    return {
      callId: call.id,
      name: call.name,
      content: "",
      error:
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Erreur lors de l'exécution de l'outil.",
    };
  }
}

export interface AuthorizedToolExecutionOptions {
  approval?: ApprovalSource;
  depth?: number;
  /** Clé stable pour éviter les doubles commits après retry/reprise. */
  idempotencyKey?: string;
}

function parseToolArgumentsForAudit(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function recordAuthorizationAudit(
  actionType: string,
  call: ToolCall,
  decision: ReturnType<typeof authorizeToolCall>,
  approval: ApprovalSource,
  idempotencyKey: string,
  result?: ToolResult,
): void {
  requestStore.getState().addAiAuditEntry?.({
    actionType,
    detail: {
      tool: call.name,
      toolCallId: call.id,
      permission: decision.permission,
      approvalSource: approval,
      idempotencyKey,
      decision: decision.allowed ? "allow" : decision.requiresConfirmation ? "ask" : "deny",
      reason: decision.reason,
      arguments: maskSensitiveObject(parseToolArgumentsForAudit(call.arguments)),
    },
    result: result
      ? {
          ok: !result.error,
          error: result.error,
        }
      : undefined,
  });
}

/**
 * Point d’entrée unique pour les tool calls issus de toutes les surfaces IA.
 * Le handler brut n’est appelé qu’après la décision d’autorisation.
 */
export async function executeAuthorizedToolCall(
  call: ToolCall,
  options: AuthorizedToolExecutionOptions = {},
): Promise<ToolResult> {
  const approval = options.approval ?? "none";
  const idempotencyKey = options.idempotencyKey ?? `${call.id}:${call.name}:${call.arguments}`;
  const decision = authorizeToolCall(call.name, approval);

  if (!decision.allowed) {
    const result: ToolResult = {
      callId: call.id,
      name: call.name,
      content: "",
      error: decision.reason,
      ...(decision.requiresConfirmation ? { requireConfirmation: true } : {}),
    };
    recordAuthorizationAudit(
      decision.requiresConfirmation ? "AI_TOOL_CONFIRMATION_REQUIRED" : "AI_TOOL_DENIED",
      call,
      decision,
      approval,
      idempotencyKey,
      result,
    );
    return result;
  }

  const previousCommit = requestStore.getState().aiAudit?.some((entry) => {
    if (entry.actionType !== "AI_TOOL_COMMITTED") return false;
    const detail = entry.detail;
    return (
      detail &&
      typeof detail === "object" &&
      (detail as { idempotencyKey?: unknown }).idempotencyKey === idempotencyKey
    );
  });
  if (previousCommit) {
    const result: ToolResult = {
      callId: call.id,
      name: call.name,
      content: "",
      error: "Cet appel d’outil a déjà été exécuté; nouvelle exécution bloquée.",
    };
    recordAuthorizationAudit(
      "AI_TOOL_DUPLICATE_BLOCKED",
      call,
      decision,
      approval,
      idempotencyKey,
      result,
    );
    return result;
  }

  recordAuthorizationAudit("AI_TOOL_APPROVED", call, decision, approval, idempotencyKey);
  try {
    const result = await executeToolCall(call, {
      depth: options.depth ?? 0,
      confirmed: true,
    });
    recordAuthorizationAudit("AI_TOOL_COMMITTED", call, decision, approval, idempotencyKey, result);
    return result;
  } catch (error) {
    const result: ToolResult = {
      callId: call.id,
      name: call.name,
      content: "",
      error: error instanceof Error ? error.message : String(error),
    };
    recordAuthorizationAudit(
      "AI_TOOL_COMMIT_FAILED",
      call,
      decision,
      approval,
      idempotencyKey,
      result,
    );
    return result;
  }
}

// ─── Registre des outils disponibles ───────────────────────────────────────

export const REQLY_TOOLS: ReqlyTool[] = [
  {
    name: "list_collections",
    title: "Lister les collections",
    description: "Liste toutes les collections disponibles dans le workspace actif.",
    parameters: {},
    handler: handleListCollections,
  },
  {
    name: "get_request_context",
    title: "Contexte de la requête",
    description:
      "Retourne le contexte de la requête actuelle (méthode, URL, status, extrait du body).",
    parameters: {},
    handler: handleGetRequestContext,
  },
  {
    name: "create_collection",
    title: "Créer une collection",
    description:
      "Crée une nouvelle collection dans le workspace actif. Nécessite une confirmation dans l'interface.",
    parameters: {
      name: { type: "string", description: "Nom de la collection à créer.", required: true },
    },
    handler: handleCreateCollection,
  },
  {
    name: "create_request",
    title: "Créer une requête",
    description: "Crée une requête dans une collection existante.",
    parameters: {
      collection: { type: "string", description: "Nom de la collection cible.", required: true },
      method: {
        type: "string",
        description: "Méthode HTTP (GET, POST, PUT, DELETE, PATCH, etc.).",
        required: true,
      },
      url: { type: "string", description: "URL complète de la requête.", required: true },
      name: { type: "string", description: "Nom de la requête (optionnel)." },
    },
    handler: handleCreateRequest,
  },
  {
    name: "execute_request",
    title: "Exécuter une requête",
    description:
      "Exécute la requête décrite par method + url (+ headers/body optionnels) et retourne le résultat HTTP.",
    parameters: {
      method: { type: "string", description: "Méthode HTTP.", required: true },
      url: { type: "string", description: "URL cible.", required: true },
      headers: { type: "object", description: "Headers optionnels, sous forme d'objet." },
      body: { type: "string", description: "Body brut (JSON, form-data, etc.)." },
    },
    handler: handleExecuteRequest,
  },
  {
    name: "rename_collection",
    title: "Renommer une collection",
    description: "Renomme une collection existante.",
    parameters: {
      name: { type: "string", description: "Nom actuel de la collection.", required: true },
      new_name: { type: "string", description: "Nouveau nom.", required: true },
    },
    handler: handleRenameCollection,
  },
  {
    name: "delete_collection",
    title: "Supprimer une collection",
    description: "Supprime une collection. Nécessite une confirmation explicite de l'utilisateur.",
    parameters: {
      name: { type: "string", description: "Nom de la collection à supprimer.", required: true },
    },
    handler: handleDeleteCollection,
  },
  {
    name: "create_environment",
    title: "Créer un environnement",
    description: "Crée un nouvel environnement.",
    parameters: {
      name: { type: "string", description: "Nom de l'environnement.", required: true },
    },
    handler: handleCreateEnvironment,
  },
  {
    name: "update_environment_variable",
    title: "Modifier une variable d'environnement",
    description:
      "Ajoute ou modifie une variable d'environnement. Les valeurs sensibles sont masquées automatiquement.",
    parameters: {
      environment: { type: "string", description: "Nom de l'environnement.", required: true },
      key: { type: "string", description: "Nom de la variable.", required: true },
      value: { type: "string", description: "Valeur de la variable.", required: true },
    },
    handler: handleUpdateEnvironmentVariable,
  },
  {
    name: "delegate",
    title: "Déléguer à un sous-agent",
    description:
      "Délègue une sous-tâche ciblée à un agent spécialisé du registre (analyste, testeur, securite, architecte, optimiseur) ou à un rôle libre, puis retourne son résultat. Pour plusieurs perspectives À LA FOIS, préfère delegate_team.",
    parameters: {
      agent: {
        type: "string",
        description: `Identifiant d'agent du registre (${SPECIALIST_IDS.join(", ")}). Remplace role.`,
        enum: SPECIALIST_IDS,
      },
      role: {
        type: "string",
        description: "Persona libre (si aucun agent du registre ne convient).",
      },
      instruction: {
        type: "string",
        description: "La sous-tâche précise à accomplir.",
        required: true,
      },
      context: {
        type: "string",
        description: "Contexte pertinent pour la sous-tâche (limité à 6000 caractères).",
      },
    },
    handler: handleDelegate,
  },
  {
    name: "delegate_team",
    title: "Consulter une équipe d'agents (parallèle)",
    description:
      "Lance SIMULTANÉMENT 2 à 4 sous-agents du registre sur des tâches différentes et agrège leurs réponses (une seule confirmation pour toute l'équipe). Utilise pour croiser les perspectives : ex. analyste + securite sur une même réponse.",
    parameters: {
      tasks: {
        type: "array",
        description:
          'Liste de 2 à 4 objets {agent:"analyste"|"testeur"|"securite"|"architecte"|"optimiseur", instruction:string, context?:string}. Chaque agent tourne en parallèle.',
        required: true,
      },
    },
    handler: handleDelegateTeam,
  },
  {
    name: "run_collection",
    title: "Exécuter une collection",
    description:
      "Exécute toutes les requêtes d'une collection et retourne un rapport détaillé (statut, temps de réponse, erreurs). Les assertions sont évaluées automatiquement.",
    parameters: {
      collection: {
        type: "string",
        description: "Nom de la collection à exécuter.",
        required: true,
      },
    },
    handler: handleRunCollection,
  },
  {
    name: "import_collection",
    title: "Importer une collection",
    description:
      "Importe une collection depuis un fichier OpenAPI, Bruno ou Postman. Spécifiez le format et le contenu du fichier.",
    parameters: {
      format: {
        type: "string",
        description: "Format du fichier : openapi, bruno ou postman.",
        required: true,
        enum: ["openapi", "bruno", "postman"],
      },
      content: {
        type: "string",
        description: "Contenu brut du fichier à importer.",
        required: true,
      },
      collection_name: {
        type: "string",
        description: "Nom optionnel pour la collection importée.",
      },
    },
    handler: handleImportCollection,
  },
  {
    name: "search_requests",
    title: "Rechercher des requêtes",
    description:
      "Recherche sémantique dans les requêtes indexées. Retourne les requêtes les plus pertinentes avec leur score.",
    parameters: {
      query: {
        type: "string",
        description: "Requête de recherche en langage naturel.",
        required: true,
      },
      top_k: {
        type: "number",
        description: "Nombre de résultats à retourner (défaut: 5, max: 20).",
      },
    },
    handler: handleSearchRequests,
  },
  {
    name: "switch_workspace",
    title: "Changer de workspace",
    description: "Bascule vers un workspace existant par nom ou identifiant.",
    parameters: {
      name: { type: "string", description: "Nom du workspace." },
      id: { type: "string", description: "Identifiant du workspace." },
    },
    handler: handleSwitchWorkspace,
  },
  {
    name: "list_workspaces",
    title: "Lister les workspaces",
    description: "Liste tous les workspaces disponibles et indique le workspace actif.",
    parameters: {},
    handler: handleListWorkspaces,
  },
  {
    name: "get_current_workspace",
    title: "Workspace actif",
    description: "Retourne les détails du workspace actif (nom, description, couleur, icône).",
    parameters: {},
    handler: handleGetCurrentWorkspace,
  },
  {
    name: "get_workspace",
    title: "Détails d'un workspace",
    description:
      "Retourne les détails d'un workspace : nb collections, nb requêtes, dernière activité.",
    parameters: {
      name: { type: "string", description: "Nom du workspace." },
      id: { type: "string", description: "Identifiant du workspace." },
    },
    handler: handleGetWorkspace,
  },
  {
    name: "search_workspaces",
    title: "Rechercher des workspaces",
    description: "Recherche des workspaces par nom ou description.",
    parameters: {
      query: { type: "string", description: "Requête de recherche.", required: true },
    },
    handler: handleSearchWorkspaces,
  },
  {
    name: "duplicate_workspace",
    title: "Dupliquer un workspace",
    description: "Duplique un workspace entier (collections, requêtes, environnements).",
    parameters: {
      name: { type: "string", description: "Nom du workspace à dupliquer." },
      id: { type: "string", description: "Identifiant du workspace à dupliquer." },
    },
    handler: handleDuplicateWorkspace,
  },
  {
    name: "archive_workspace",
    title: "Archiver un workspace",
    description: "Archive un workspace (le masque de la liste active sans le supprimer).",
    parameters: {
      name: { type: "string", description: "Nom du workspace." },
      id: { type: "string", description: "Identifiant du workspace." },
    },
    handler: handleArchiveWorkspace,
  },
  {
    name: "unarchive_workspace",
    title: "Désarchiver un workspace",
    description: "Désarchive un workspace précédemment archivé.",
    parameters: {
      name: { type: "string", description: "Nom du workspace." },
      id: { type: "string", description: "Identifiant du workspace." },
    },
    handler: handleUnarchiveWorkspace,
  },
  {
    name: "get_workspace_stats",
    title: "Statistiques du workspace",
    description:
      "Retourne les statistiques du workspace actif : nb collections, requêtes, taux de succès.",
    parameters: {},
    handler: handleGetWorkspaceStats,
  },
  {
    name: "clear_workspace_cache",
    title: "Vider le cache du workspace",
    description:
      "Vide l'historique et le cache du workspace actif (ne supprime pas les collections).",
    parameters: {},
    handler: handleClearWorkspaceCache,
  },
  {
    name: "explain_response",
    title: "Expliquer la réponse",
    description:
      "Explique un élément de réponse HTTP : décode un JWT, explique un header, ou annote une structure JSON.",
    parameters: {
      type: {
        type: "string",
        description: "Type d'élément à expliquer : jwt, header ou json.",
        required: true,
        enum: ["jwt", "header", "json"],
      },
      value: {
        type: "string",
        description: "Valeur à analyser (token JWT, header, ou JSON brut).",
        required: true,
      },
      header_name: {
        type: "string",
        description: "Nom du header (si type=header et value contient seulement la valeur).",
      },
      header_value: {
        type: "string",
        description: "Valeur du header (si type=header et value contient seulement le nom).",
      },
    },
    handler: handleExplainResponse,
  },
  {
    name: "propose_assertion_fix",
    title: "Proposer une correction d'assertion",
    description:
      "Propose une correction pour une assertion échouée (statut, temps de réponse, jsonPath). Retourne une suggestion sans modifier l'assertion.",
    parameters: {
      assertion_type: {
        type: "string",
        description: "Type d'assertion : status, responseTime ou jsonPath.",
        required: true,
      },
      target: {
        type: "string",
        description: "Cible de l'assertion (ex: status, responseTime, ou chemin jsonPath).",
        required: true,
      },
      expected_value: { type: "string", description: "Valeur attendue de l'assertion." },
      actual_value: { type: "string", description: "Valeur réelle observée (JSON brut)." },
    },
    handler: handleProposeAssertionFix,
  },
  {
    name: "export_collection",
    title: "Exporter une collection",
    description: "Exporte une collection au format OpenAPI 3.0 (JSON).",
    parameters: {
      name: { type: "string", description: "Nom de la collection à exporter.", required: true },
    },
    handler: handleExportCollection,
  },
  {
    name: "duplicate_collection",
    title: "Dupliquer une collection",
    description: "Duplique une collection existante (y compris ses requêtes et dossiers).",
    parameters: {
      name: { type: "string", description: "Nom de la collection à dupliquer.", required: true },
    },
    handler: handleDuplicateCollection,
  },
  {
    name: "delete_request",
    title: "Supprimer une requête",
    description: "Supprime une requête d'une collection.",
    parameters: {
      collection: { type: "string", description: "Nom de la collection.", required: true },
      request: { type: "string", description: "Nom de la requête à supprimer.", required: true },
    },
    handler: handleDeleteRequest,
  },
  {
    name: "move_request",
    title: "Déplacer une requête",
    description: "Déplace une requête d'une collection vers une autre.",
    parameters: {
      source_collection: {
        type: "string",
        description: "Nom de la collection source.",
        required: true,
      },
      target_collection: {
        type: "string",
        description: "Nom de la collection cible.",
        required: true,
      },
      request: { type: "string", description: "Nom de la requête à déplacer.", required: true },
    },
    handler: handleMoveRequest,
  },
  {
    name: "create_folder",
    title: "Créer un dossier",
    description: "Crée un dossier dans une collection pour organiser les requêtes.",
    parameters: {
      collection: { type: "string", description: "Nom de la collection.", required: true },
      name: { type: "string", description: "Nom du dossier à créer.", required: true },
    },
    handler: handleCreateFolder,
  },
  // Outils Mock Server (pont brouillon via components/mock/mock-draft-bridge).
  ...MOCK_AI_TOOLS,
  // Outils capture proxy (trafic réel → mock).
  ...CAPTURE_AI_TOOLS,
  // Outils Git read-only (dépôt ouvert via le panneau Git).
  ...GIT_AI_TOOLS,
];
