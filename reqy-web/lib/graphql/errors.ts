import { isBlockedIp, isIP } from "@/lib/security/ssrf";

/**
 * Messages d'erreur GraphQL conviviaux (français, actionnables).
 * Le détail technique est conservé en fin de message pour le diagnostic.
 */

/**
 * Validation d'hôte côté client (les WebSockets se connectent directement, pas
 * via /api/proxy) : on bloque les IP littérales privées/réservées et les
 * hostnames locaux. Les domaines publics sont autorisés (le DNS est résolu par
 * le navigateur). Complément défensif — la vraie protection SSRF reste sur le
 * serveur pour le trafic HTTP routé via le proxy.
 */
function isBlockedSubscriptionHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost") return true;
  if (lower.endsWith(".local") || lower.endsWith(".internal") || lower.endsWith(".lan")) {
    return true;
  }
  if (isIP(lower) !== 0) return isBlockedIp(lower);
  return false;
}

export function friendlyGraphQLError(status: number, detail?: string): string {
  const d = detail && detail !== "Invalid proxy response" ? ` (${detail})` : "";
  switch (status) {
    case 401:
      return `Authentification requise par l'endpoint GraphQL : vérifiez les headers envoyés (Authorization, cookies…).${d}`;
    case 403:
      return `Accès refusé par l'endpoint GraphQL : vérifiez vos droits sur le serveur.${d}`;
    case 404:
      return `Endpoint GraphQL introuvable (404) : vérifiez que l'URL pointe bien vers l'API GraphQL.${d}`;
    case 429:
      return `Trop de requêtes : patientez une minute avant de réessayer.${d}`;
    case 500:
    case 502:
    case 503:
      return `Le serveur GraphQL a renvoyé une erreur (${status}) : réessayez dans quelques instants.${d}`;
    default:
      return `Impossible de contacter l'endpoint GraphQL. Vérifiez l'URL et votre connexion internet.${d}`;
  }
}

/**
 * Valide l'URL d'une subscription GraphQL, de la même façon que l'URL d'une
 * requête (schéma http/https/ws/wss + format). Retourne l'URL ws/wss prête à
 * l'emploi, ou une erreur française actionnable.
 */
export function validateSubscriptionEndpoint(
  endpoint: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = (endpoint ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "URL du serveur GraphQL manquante." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Format d'URL invalide pour la subscription." };
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  } else if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return {
      ok: false,
      error:
        "L'URL doit commencer par http://, https://, ws:// ou wss:// (les subscriptions utilisent WebSocket).",
    };
  }

  // Les subscriptions WebSocket se connectent directement (pas via /api/proxy) :
  // on bloque donc les hôtes privés/réservés côté client, faute de protection
  // SSRF serveur sur ce canal (même posture que le proxy pour le trafic HTTP).
  if (isBlockedSubscriptionHost(parsed.hostname)) {
    return {
      ok: false,
      error:
        "Les subscriptions vers des hôtes privés ou locaux ne sont pas autorisées (localhost, IP privées, *.local…).",
    };
  }

  // Page en HTTPS → une connexion ws:// non chiffrée serait bloquée par le
  // navigateur (mixed content) : autant le signaler clairement.
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    parsed.protocol === "ws:"
  ) {
    return {
      ok: false,
      error:
        "Connexion non chiffrée refusée sur une page HTTPS : utilisez un endpoint wss:// (ou https://).",
    };
  }

  return { ok: true, url: parsed.toString() };
}
