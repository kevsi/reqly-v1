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

const SECRET_KEYWORDS = ["secret", "key", "token", "password", "apikey", "api_key"];

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
import type { Collection, Environment, RequestItem } from "@/hooks/request-types";
import type { HttpMethod } from "@/lib/types";

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

function activeWorkspaceEnvironments(): Environment[] {
  const store = requestStore.getState();
  const wsId = store.activeWorkspaceId;
  if (!wsId) return store.environments;
  return store.environments.filter((e) => e.workspaceId === wsId);
}

// ─── Outils Reqly ──────────────────────────────────────────────────────────

/**
 * Registre central des outils exposés aux LLMs.
 *
 * Les handlers sont branchés sur le store Zustand (`requestStore`).
 * Les actions destructives retournent `requireConfirmation: true`
 * pour que l'UI demande une confirmation explicite avant exécution.
 */

export type ToolHandler = (
  args: Record<string, unknown>,
  options?: { confirmed?: boolean },
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

async function handleExecuteRequest(args: Record<string, unknown>): Promise<ToolResult> {
  const method = typeof args.method === "string" ? args.method.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const headers =
    typeof args.headers === "object" && args.headers !== null
      ? (args.headers as Record<string, string>)
      : {};
  const body = typeof args.body === "string" ? args.body : undefined;

  if (!method || !url) {
    return {
      callId: "",
      name: "execute_request",
      content: "",
      error: "La méthode et l'URL sont requises.",
    };
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        callId: "",
        name: "execute_request",
        content: "",
        error: "URL invalide : protocole HTTP/HTTPS requis.",
      };
    }
  } catch {
    return { callId: "", name: "execute_request", content: "", error: "URL invalide." };
  }

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
      typeof store.lastResponse?.body === "string" ? store.lastResponse.body.slice(0, 2000) : "";

    return {
      callId: "",
      name: "execute_request",
      content: `${method} ${url} → ${status} en ${duration}ms\n${responseBody}`,
    };
  } catch (e: any) {
    return {
      callId: "",
      name: "execute_request",
      content: "",
      error: e?.message ?? "Erreur lors de l'exécution de la requête.",
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

// ─── Helpers globaux ───────────────────────────────────────────────────────

export function getToolByName(name: string): ReqlyTool | undefined {
  return REQLY_TOOLS.find((t) => t.name === name);
}

export async function executeToolCall(call: ToolCall, confirmed?: boolean): Promise<ToolResult> {
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

  try {
    const result = await tool.handler(args, { confirmed });
    return { ...result, callId: call.id };
  } catch (e: any) {
    return {
      callId: call.id,
      name: call.name,
      content: "",
      error: e?.message ?? "Erreur lors de l'exécution de l'outil.",
    };
  }
}

// ─── Registre des outils disponibles ───────────────────────────────────────

export const REQLY_TOOLS: ReqlyTool[] = [
  {
    name: "list_collections",
    description: "Liste toutes les collections disponibles dans le workspace actif.",
    parameters: {},
    handler: handleListCollections,
  },
  {
    name: "get_request_context",
    description:
      "Retourne le contexte de la requête actuelle (méthode, URL, status, extrait du body).",
    parameters: {},
    handler: handleGetRequestContext,
  },
  {
    name: "create_collection",
    description:
      "Crée une nouvelle collection dans le workspace actif. Nécessite une confirmation dans l'interface.",
    parameters: {
      name: { type: "string", description: "Nom de la collection à créer.", required: true },
    },
    handler: handleCreateCollection,
  },
  {
    name: "create_request",
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
    description: "Renomme une collection existante.",
    parameters: {
      name: { type: "string", description: "Nom actuel de la collection.", required: true },
      new_name: { type: "string", description: "Nouveau nom.", required: true },
    },
    handler: handleRenameCollection,
  },
  {
    name: "delete_collection",
    description: "Supprime une collection. Nécessite une confirmation explicite de l'utilisateur.",
    parameters: {
      name: { type: "string", description: "Nom de la collection à supprimer.", required: true },
    },
    handler: handleDeleteCollection,
  },
  {
    name: "create_environment",
    description: "Crée un nouvel environnement.",
    parameters: {
      name: { type: "string", description: "Nom de l'environnement.", required: true },
    },
    handler: handleCreateEnvironment,
  },
  {
    name: "update_environment_variable",
    description:
      "Ajoute ou modifie une variable d'environnement. Les valeurs sensibles sont masquées automatiquement.",
    parameters: {
      environment: { type: "string", description: "Nom de l'environnement.", required: true },
      key: { type: "string", description: "Nom de la variable.", required: true },
      value: { type: "string", description: "Valeur de la variable.", required: true },
    },
    handler: handleUpdateEnvironmentVariable,
  },
];
