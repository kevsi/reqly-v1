"use client";

/**
 * Outils IA autour du proxy de capture (trafic réel).
 * - get_capture_sessions      : lecture des sessions capturées (read-only).
 * - generate_mock_from_capture: conversion sessions → config mock validée,
 *   écrite dans le brouillon via le pont existant (side-effect → `ask`).
 */
import { sanitizeConfig } from "@/components/mock/mock-utils";
import { writeMockDraft } from "@/components/mock/mock-draft-bridge";
import {
  captureSessionsToMockConfig,
  type CaptureSessionLike,
} from "@/lib/mock/capture-to-mock";
import type { ReqlyTool, ToolResult } from "@/lib/llm-tools";

interface ApiCaptureSession {
  id?: string;
  request?: { method?: string; url?: string };
  response?: { statusCode?: number; body?: string };
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const BODY_PREVIEW_CHARS = 160;

async function fetchSessions(limit: number): Promise<CaptureSessionLike[]> {
  const res = await fetch(`/api/capture/sessions?sort=newest&limit=${limit}`);
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Capture indisponible : authentifie-toi d'abord."
        : `Liste des captures inaccessible (HTTP ${res.status}).`,
    );
  }
  const data = (await res.json()) as { sessions?: ApiCaptureSession[] };
  return (data.sessions ?? [])
    .filter((s): s is ApiCaptureSession & Required<Pick<ApiCaptureSession, "id">> => !!s.id)
    .map((s) => ({
      id: s.id,
      request: {
        method: String(s.request?.method ?? "GET"),
        url: String(s.request?.url ?? "/"),
      },
      response: {
        statusCode: Number(s.response?.statusCode ?? 200),
        body: String(s.response?.body ?? ""),
      },
    }));
}

async function handleGetCaptureSessions(args: Record<string, unknown>): Promise<ToolResult> {
  const rawLimit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.round(rawLimit), 1), MAX_LIMIT);
  try {
    const sessions = await fetchSessions(limit);
    return {
      callId: "",
      name: "get_capture_sessions",
      content: JSON.stringify({
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          method: s.request.method,
          url: s.request.url,
          status: s.response.statusCode,
          bodyPreview:
            s.response.body.length > BODY_PREVIEW_CHARS
              ? `${s.response.body.slice(0, BODY_PREVIEW_CHARS)}…`
              : s.response.body,
        })),
      }),
    };
  } catch (err) {
    return {
      callId: "",
      name: "get_capture_sessions",
      content: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleGenerateMockFromCapture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const rawLimit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.round(rawLimit), 1), MAX_LIMIT);
  const wantedIds =
    Array.isArray(args.session_ids) && args.session_ids.every((v) => typeof v === "string")
      ? (args.session_ids as string[])
      : null;
  try {
    let sessions = await fetchSessions(MAX_LIMIT);
    if (wantedIds && wantedIds.length > 0) {
      const idSet = new Set(wantedIds);
      sessions = sessions.filter((s) => idSet.has(s.id));
      if (sessions.length === 0) {
        return {
          callId: "",
          name: "generate_mock_from_capture",
          content: "",
          error:
            "Aucune session correspondant aux ids fournis. Utilise get_capture_sessions pour lister les ids.",
        };
      }
    }
    sessions = sessions.slice(0, limit);
    if (sessions.length === 0) {
      return {
        callId: "",
        name: "generate_mock_from_capture",
        content: "",
        error:
          "Aucune capture disponible. Lance une capture depuis l'onglet Capture et rejoue quelques requêtes.",
      };
    }

    const generated = captureSessionsToMockConfig(sessions);
    const clean = sanitizeConfig(generated);
    if (!clean) {
      return {
        callId: "",
        name: "generate_mock_from_capture",
        content: "",
        error: "La config générée depuis les captures est invalide (cas inattendu).",
      };
    }

    const written = writeMockDraft(clean);
    if (!written) {
      return {
        callId: "",
        name: "generate_mock_from_capture",
        content: JSON.stringify({
          written: false,
          reason:
            "Page Mock non ouverte. La config est prête — demande à l'utilisateur d'ouvrir la page Mock puis relance.",
          routeCount: clean.routes.length,
          routes: clean.routes.map((r) => `${String(r.method).toUpperCase()} ${r.path}`),
        }),
      };
    }
    return {
      callId: "",
      name: "generate_mock_from_capture",
      content: JSON.stringify({
        written: true,
        routeCount: clean.routes.length,
        port: clean.port ?? null,
        routes: clean.routes.map((r) => ({
          method: String(r.method).toUpperCase(),
          path: r.path,
          statusCodes: (r.responses ?? []).map((resp) => resp.statusCode),
        })),
      }),
    };
  } catch (err) {
    return {
      callId: "",
      name: "generate_mock_from_capture",
      content: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const CAPTURE_AI_TOOLS: ReqlyTool[] = [
  {
    name: "get_capture_sessions",
    description:
      "Liste les requêtes réelles capturées par le proxy Reqly (méthode, URL, statut, extrait du corps).",
    parameters: {
      limit: {
        type: "number",
        description: `Nombre max de sessions (défaut ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
      },
    },
    handler: handleGetCaptureSessions,
  },
  {
    name: "generate_mock_from_capture",
    description:
      "Génère et applique une config de mock à partir du trafic capturé réel. Regroupe par méthode+chemin, paramètre les ids numériques/uuid, déduplique les statuts. Nécessite une confirmation.",
    parameters: {
      session_ids: {
        type: "array",
        description:
          "Ids précis de sessions à convertir (via get_capture_sessions). Absent = les plus récentes.",
      },
      limit: {
        type: "number",
        description: `Nombre max de sessions utilisées (défaut ${DEFAULT_LIMIT}).`,
      },
    },
    handler: handleGenerateMockFromCapture,
  },
];
