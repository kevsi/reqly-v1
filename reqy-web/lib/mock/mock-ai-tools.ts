"use client";

/**
 * Outils IA dédiés au Mock Server, exposés au registre REQLY_TOOLS.
 *
 * - get_mock_draft      : lecture du brouillon courant (read-only).
 * - validate_mock_config: validation stricte d'une config via sanitizeConfig
 *                         (read-only, pur) — c'est l'outil que le modèle doit
 *                         appeler pour garantir une config valide.
 * - replace_mock_draft  : remplacement du brouillon après validation
 *                         (side-effect → permission `ask`).
 */
import type { MockConfig } from "@reqly/mock-engine";
import { sanitizeConfig } from "@/components/mock/mock-utils";
import {
  getMockDraft,
  writeMockDraft,
} from "@/components/mock/mock-draft-bridge";
import type { ReqlyTool, ToolResult } from "@/lib/llm-tools";

const CONFIG_SHAPE_DOC = `Attendu: { version:1, name?, port?, host?, basePath?, cors?, routes:[{
  id (slug unique), enabled?, method (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS),
  path ("/api/users/:id", suffixe "*splat" supporté), responses:[{ id, statusCode,
  headers?, body (string JSON), schema? }], defaultResponseId?, latency?{minMs,maxMs},
  failure?{probability,kind:"status"|"timeout"|"reset"|"malformed",statusCode?,timeoutMs?},
  stateful?{enabled,resource?,idField?}, transform? }] }`;

function draftSummary(config: MockConfig | null): string {
  if (!config) return JSON.stringify({ configured: false });
  return JSON.stringify({
    configured: true,
    name: config.name ?? null,
    port: config.port ?? null,
    basePath: config.basePath ?? null,
    routeCount: config.routes.length,
    routes: config.routes.map((r) => ({
      id: r.id,
      method: String(r.method).toUpperCase(),
      path: r.path,
      enabled: r.enabled !== false,
      statusCodes: (r.responses ?? []).map((resp) => resp.statusCode),
      latency: r.latency ?? null,
      failure: r.failure ?? null,
      stateful: !!r.stateful?.enabled,
    })),
  });
}

async function handleGetMockDraft(): Promise<ToolResult> {
  return {
    callId: "",
    name: "get_mock_draft",
    content: draftSummary(getMockDraft()),
  };
}

export async function handleValidateMockConfig(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const clean = sanitizeConfig(args.config);
  if (!clean) {
    return {
      callId: "",
      name: "validate_mock_config",
      content:
        "Config invalide. Requis: version=1, routes[] non vide, chaque route avec method/path/responses[{id,statusCode}]. " +
        CONFIG_SHAPE_DOC,
      error: "invalid_config",
    };
  }
  return {
    callId: "",
    name: "validate_mock_config",
    content: JSON.stringify({
      valid: true,
      routeCount: clean.routes.length,
      port: clean.port ?? null,
      routes: clean.routes.map((r) => `${String(r.method).toUpperCase()} ${r.path}`),
    }),
  };
}

async function handleReplaceMockDraft(args: Record<string, unknown>): Promise<ToolResult> {
  const clean = sanitizeConfig(args.config);
  if (!clean) {
    return {
      callId: "",
      name: "replace_mock_draft",
      content:
        "Config invalide, brouillon inchangé. " + CONFIG_SHAPE_DOC,
      error: "invalid_config",
    };
  }
  const ok = writeMockDraft(clean);
  if (!ok) {
    return {
      callId: "",
      name: "replace_mock_draft",
      content: "",
      error: "Page mock non ouverte : impossible d'écrire le brouillon.",
    };
  }
  return {
    callId: "",
    name: "replace_mock_draft",
    content: JSON.stringify({ replaced: true, routeCount: clean.routes.length }),
  };
}

export const MOCK_AI_TOOLS: ReqlyTool[] = [
  {
    name: "get_mock_draft",
    description:
      "Liste les routes du brouillon du Mock Server (méthode, path, statuts, latence, panne, stateful).",
    parameters: {},
    handler: handleGetMockDraft,
  },
  {
    name: "validate_mock_config",
    description:
      "Valide une configuration de mock complète contre le schéma du moteur. À appeler avant tout remplacement.",
    parameters: {
      config: {
        type: "object",
        description: `Objet de configuration complet. ${CONFIG_SHAPE_DOC}`,
        required: true,
      },
    },
    handler: handleValidateMockConfig,
  },
  {
    name: "replace_mock_draft",
    description:
      "Remplace le brouillon du Mock Server par la config fournie (validée automatiquement). Nécessite une confirmation.",
    parameters: {
      config: {
        type: "object",
        description: `Objet de configuration complet. ${CONFIG_SHAPE_DOC}`,
        required: true,
      },
    },
    handler: handleReplaceMockDraft,
  },
];
