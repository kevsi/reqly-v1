import type { Collection, RequestItem } from "@/hooks/request-types";
import type { MockConfig, MockRoute } from "@reqly/mock-engine";

/**
 * Convertit une collection Reqly en config de mock.
 * Chaque requête devient une route avec une réponse 200 squelette ;
 * l'utilisateur affine ensuite dans l'éditeur (schémas, règles, pannes).
 */

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function normalizePath(request: RequestItem): string {
  const raw = (request.endpoint || request.url || "/").trim();
  if (!raw) return "/";
  // URL absolue → ne garder que le pathname (+ query ignorée : les mocks
  // matchent sur le chemin ; les conditions de query se règlent par règles).
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      return u.pathname || "/";
    }
  } catch {
    /* pas une URL valide → traiter comme chemin brut */
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

let counter = 0;
function routeId(method: string, path: string): string {
  counter += 1;
  const slug = `${method}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${counter}`;
}

export function collectionToMockRoutes(collection: Collection): MockRoute[] {
  const routes: MockRoute[] = [];
  for (const request of collection.requests ?? []) {
    const method = String(request.method || "GET").toUpperCase();
    if (!METHODS.has(method)) continue;
    const route: MockRoute = {
      id: routeId(method, normalizePath(request)),
      method: method as MockRoute["method"],
      path: normalizePath(request),
      responses: [
        {
          id: `${routeId(method, normalizePath(request))}-r1`,
          name: request.name || undefined,
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: '{"ok":true}',
        },
      ],
      meta: { sourceCollectionId: collection.id, sourceRequestId: request.id },
    };
    routes.push(route);
  }
  return routes;
}

export function collectionsToMockConfig(
  collections: Collection[],
  base?: Partial<Pick<MockConfig, "name" | "port" | "cors">>,
): MockConfig {
  const routes = collections.flatMap((c) => collectionToMockRoutes(c));
  return {
    version: 1,
    name:
      base?.name ??
      (collections[0]
        ? `mock-${collections[0].name.toLowerCase().replace(/\s+/g, "-")}`
        : "reqly-mock"),
    port: base?.port ?? 4015,
    cors: base?.cors ?? true,
    routes,
  };
}

// ── Brouillon local (autosave de l'éditeur) ─────────────────────────────

const DRAFT_KEY = "reqly-mock-draft";

export function saveMockDraft(config: MockConfig): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(config));
  } catch {
    /* quota / mode privé — l'export fichier reste la source fiable */
  }
}

export function loadMockDraft(): MockConfig | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockConfig;
    return parsed.version === 1 && Array.isArray(parsed.routes) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearMockDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}
