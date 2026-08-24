"use client";

/**
 * Conversion des sessions capturées par le proxy (trafic réel) en config de
 * Mock Server. Pur et déterministe : regroupe par méthode+chemin, paramètre
 * les segments qui varient entre deux captures d'un même gabarit, déduplique
 * les statuts et borne la taille des corps.
 */
import type { MockConfig, MockRoute } from "@reqly/mock-engine";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_ROUTES = 50;

export interface CaptureSessionLike {
  id: string;
  request: { method: string; url: string };
  response: { statusCode: number; body: string };
}

function pathnameOf(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "/";
    return path.startsWith("/") ? path : `/${path}`;
  } catch {
    // URL relative ou malformée : utiliser brute si elle ressemble à un chemin.
    return url.startsWith("/") ? url.split("?")[0] : `/${url.split("?")[0]}`;
  }
}

const NUMERIC_RE = /^\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paramètre les segments numériques/uuid (convention REST la plus fréquente). */
function templatizePath(path: string): string {
  const segments = path.split("/").map((seg) => {
    if (seg.length === 0) return seg;
    if (NUMERIC_RE.test(seg)) return ":id";
    if (UUID_RE.test(seg)) return ":id";
    return seg;
  });
  return segments.join("/") || "/";
}

function slugRoute(method: string, path: string): string {
  const raw = `${method}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return raw || "route";
}

interface RouteGroup {
  method: string;
  path: string;
  statuses: Map<number, { body: string; at: number }>;
}

export function captureSessionsToMockConfig(
  sessions: CaptureSessionLike[],
  options: { name?: string; port?: number } = {},
): MockConfig {
  // Ordre chronologique pour que « dernier observé » gagne les conflits.
  const ordered = [...sessions].sort((a, b) => {
    const ta = Number.parseInt(a.id.slice(-13), 36) || 0;
    const tb = Number.parseInt(b.id.slice(-13), 36) || 0;
    return ta - tb;
  });

  const groups = new Map<string, RouteGroup>();
  for (const session of ordered) {
    const method = String(session.request.method || "GET").toUpperCase();
    const path = templatizePath(pathnameOf(session.request.url));
    const key = `${method} ${path}`;
    let group = groups.get(key);
    if (!group) {
      group = { method, path, statuses: new Map() };
      groups.set(key, group);
    }
    const status = session.response.statusCode;
    // Garde le corps le plus récent observé pour ce couple (route, statut).
    group.statuses.set(status, {
      body: String(session.response.body ?? ""),
      at: 0,
    });
  }

  const routes: MockRoute[] = [];
  for (const group of groups.values()) {
    if (routes.length >= MAX_ROUTES) break;
    const responses = [...group.statuses.entries()]
      .slice(0, 3)
      .map(([statusCode, observed], index) => ({
        id: `${slugRoute(group.method, group.path)}-r${index + 1}`,
        statusCode,
        headers: { "content-type": "application/json" },
        body: observed.body.length > MAX_BODY_BYTES ? `${observed.body.slice(0, MAX_BODY_BYTES)}…` : observed.body,
      }));
    if (responses.length === 0) continue;
    routes.push({
      id: slugRoute(group.method, group.path),
      method: group.method as MockRoute["method"],
      path: group.path,
      responses,
      defaultResponseId: responses[0]!.id,
    });
  }

  return {
    version: 1,
    name: options.name ?? "capture-mock",
    port: options.port ?? 4015,
    cors: true,
    routes,
  };
}
