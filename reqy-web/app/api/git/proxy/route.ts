export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isBlockedIp } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";
import { getServerEnv } from "@/lib/env";
import { createRateLimiter } from "@/lib/rate-limiter";
import { isIP } from "node:net";

// Le proxy n'est pas une API publique générale : sans limite, il sert de
// relais générique (abus bande passante, réputation IP du déploiement).
const proxyLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

function validateGitUrl(rawUrl: string): { valid: boolean; parsed?: URL; error?: string } {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "URL manquante ou invalide" };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: "Format d'URL invalide" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: "Seuls les protocoles HTTP et HTTPS sont autorisés" };
  }

  if (!parsed.hostname) {
    return { valid: false, error: "L'URL doit contenir un nom d'hôte" };
  }

  // Restreindre aux endpoints du protocole smart-HTTP Git : le chemin peut
  // contenir un sous-répertoire arbitraire (`/org/repo.git/info/refs`), donc
  // on matche par suffixe et non par égalité.
  const path = parsed.pathname;
  const isGitSmartPath =
    path.endsWith("/info/refs") ||
    path.endsWith("/git-upload-pack") ||
    path.endsWith("/git-receive-pack");
  if (!isGitSmartPath) {
    return {
      valid: false,
      error:
        "Le proxy ne relaie que les endpoints Git (info/refs, git-upload-pack, git-receive-pack)",
    };
  }

  return { valid: true, parsed };
}

/**
 * Construit un header `Authorization` Basic à partir du token OAuth stocké
 * dans le cookie HttpOnly du fournisseur (github_token / gitlab_token).
 * Retourne `null` si aucun token n'est présent.
 */
function injectOAuthAuthHeader(
  request: NextRequest,
  isGithub: boolean,
  isGitlab: boolean,
): string | null {
  const githubToken = isGithub ? request.cookies.get("github_token")?.value : undefined;
  if (githubToken) {
    // GitHub: le PAT se passe avec n'importe quel username (x-access-token).
    return `Basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`;
  }
  const gitlabToken = isGitlab ? request.cookies.get("gitlab_token")?.value : undefined;
  if (gitlabToken) {
    // GitLab: username "oauth2" + token en password est le format recommandé.
    return `Basic ${Buffer.from(`oauth2:${gitlabToken}`).toString("base64")}`;
  }
  return null;
}

/**
 * Vérifie qu'un header Location de redirect est sûr à forwarder au client :
 * schéma http/https + hôte résolu non privé (IP littérale OU DNS).
 */
async function isSafeRedirectLocation(location: string, baseUrl: URL): Promise<boolean> {
  let locUrl: URL;
  try {
    locUrl = new URL(location, baseUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(locUrl.protocol)) return false;
  if (isIP(locUrl.hostname)) return !isBlockedIp(locUrl.hostname);
  // Hostname : résoudre le DNS sinon un domaine public pourrait pointer vers
  // une IP interne au moment où le navigateur suit le redirect.
  const address = await resolveCached(locUrl.hostname);
  if (!address || isBlockedIp(address)) return false;
  return true;
}

/** CORS : refléter uniquement les origines connues de l'app (jamais `*`). */
function allowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const allowed = new Set<string>([
    "https://tauri.localhost",
    "http://tauri.localhost",
    "tauri://localhost",
  ]);
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
    } catch {
      // ignore invalid config
    }
  }
  if (process.env.NODE_ENV === "development") {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }
  return allowed.has(origin) ? origin : null;
}

export async function GET(request: NextRequest) {
  return handleGitProxy(request, "GET");
}

export async function POST(request: NextRequest) {
  return handleGitProxy(request, "POST");
}

async function handleGitProxy(request: NextRequest, method: "GET" | "POST") {
  // Rate limit par IP (les préflights OPTIONS passent, eux).
  const { allowed } = await proxyLimiter.check(`gitproxy:${clientIp(request)}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes vers le proxy Git", code: "RATE_LIMITED" },
      { status: 429 },
    );
  }

  const urlParam = request.nextUrl.searchParams.get("url");

  if (!urlParam) {
    return NextResponse.json(
      { error: "Paramètre 'url' requis", code: "MISSING_URL" },
      { status: 400 },
    );
  }

  const urlValidation = validateGitUrl(urlParam);
  if (!urlValidation.valid || !urlValidation.parsed) {
    return NextResponse.json({ error: urlValidation.error, code: "INVALID_URL" }, { status: 400 });
  }

  const parsedUrl = urlValidation.parsed;
  let targetUrl = parsedUrl.href;
  let hostOverride: string | undefined;

  // SSRF Protection
  const env = getServerEnv();
  const allowLocal = process.env.NODE_ENV === "development" || env.ALLOW_LOCAL_HOSTS === "true";

  if (!allowLocal) {
    if (isIP(parsedUrl.hostname) && isBlockedIp(parsedUrl.hostname)) {
      return NextResponse.json(
        { error: "Accès aux hôtes privés interdit", code: "SSRF_BLOCKED" },
        { status: 403 },
      );
    }

    const address = await resolveCached(parsedUrl.hostname);
    if (!address || isBlockedIp(address)) {
      return NextResponse.json(
        { error: "Résolution DNS échouée ou IP bloquée", code: "SSRF_BLOCKED" },
        { status: 403 },
      );
    }

    const portPart = parsedUrl.port ? `:${parsedUrl.port}` : "";
    const hostLiteral = isIP(address) === 6 ? `[${address}]` : address;
    targetUrl = `${parsedUrl.protocol}//${hostLiteral}${portPart}${parsedUrl.pathname}${parsedUrl.search}`;
    hostOverride = parsedUrl.host;
  }

  // Transmettre les en-têtes pertinents
  const headersToSend = new Headers();

  const allowedHeaders = [
    "accept",
    "authorization",
    "content-type",
    "user-agent",
    "git-protocol",
    "pragma",
    "cache-control",
  ];

  request.headers.forEach((val, key) => {
    const k = key.toLowerCase();
    if (allowedHeaders.includes(k)) {
      headersToSend.set(key, val);
    }
  });

  if (hostOverride) {
    headersToSend.set("Host", hostOverride);
  }

  if (!headersToSend.has("User-Agent")) {
    headersToSend.set("User-Agent", "git/reqly-proxy");
  }

  // ── Auth helper : injecter le token OAuth (cookie HttpOnly) du fournisseur ──
  // Évite la boîte de dialogue d'authentification native du navigateur quand
  // le dépôt distant exige une authentification. Un Authorization fourni par
  // le client (via l'UI "Authentification Git") a toujours la priorité.
  if (!headersToSend.has("authorization")) {
    const host = parsedUrl.hostname.toLowerCase();
    // Comparaison d'hôte STRICTE : un `includes` permettrait d'envoyer le
    // token GitLab à `gitlab.evil.com` / `evil-gitlab.com` (exfiltration).
    const isGithub = host === "github.com" || host.endsWith(".github.com");
    const isGitlab = host === "gitlab.com" || host.endsWith(".gitlab.com");
    const injected = injectOAuthAuthHeader(request, isGithub, isGitlab);
    if (injected) {
      headersToSend.set("Authorization", injected);
    }
  }

  try {
    // Limite de taille du body (packs git) — évite l'épuisement mémoire.
    const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
    let bodyToSend: ArrayBuffer | undefined = undefined;
    if (method === "POST") {
      const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
        return NextResponse.json(
          { error: "Corps de requête trop volumineux (max 10 MB)", code: "BODY_TOO_LARGE" },
          { status: 413 },
        );
      }
      bodyToSend = await request.arrayBuffer();
      if (bodyToSend.byteLength > MAX_BODY_SIZE) {
        return NextResponse.json(
          { error: "Corps de requête trop volumineux (max 10 MB)", code: "BODY_TOO_LARGE" },
          { status: 413 },
        );
      }
    }

    // Timeout upstream : un serveur lent ne doit pas retenir le worker.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        method,
        headers: headersToSend,
        body: bodyToSend,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Transmettre la réponse binaire/texte avec les en-têtes appropriés
    const responseHeaders = new Headers();

    const allowedResponseHeaders = [
      "content-type",
      "content-length",
      "content-encoding",
      "git-protocol",
      "location",
      // "www-authenticate" est volontairement absent : forwarder cet en-tête
      // déclenche la boîte de dialogue d'authentification native du navigateur
      // (formulaire "incompréhensible") au lieu d'une erreur propre.
    ];

    for (const key of upstreamRes.headers.keys()) {
      const k = key.toLowerCase();
      if (!allowedResponseHeaders.includes(k)) continue;
      const val = upstreamRes.headers.get(key) as string;
      // Location : ne forwarder que si la cible est publique (http/https +
      // IP résolue non privée). Sinon le navigateur suivrait le redirect en
      // direct vers une adresse interne, hors du contrôle du proxy.
      if (k === "location" && !allowLocal && !(await isSafeRedirectLocation(val, parsedUrl))) {
        continue;
      }
      responseHeaders.set(key, val);
    }

    // CORS Headers pour le client web — origine reflétée uniquement si elle
    // appartient à l'app (jamais `*`, sinon n'importe quel site peut lire
    // les réponses du proxy).
    const corsOrigin = allowedCorsOrigin(request.headers.get("origin"));
    responseHeaders.set("Access-Control-Allow-Origin", corsOrigin ?? "null");
    if (corsOrigin) {
      responseHeaders.set("Vary", "Origin");
    }
    responseHeaders.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Git-Protocol, User-Agent",
    );
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    // SECURITY (audit P2 2026-09-03) : la réponse upstream était bufferée sans
    // limite (arrayBuffer) — un repo hostile pouvait faire exploser la mémoire
    // du worker. Cap 32 MB, cohérent avec les tailles des autres proxys.
    const MAX_GIT_RESPONSE_BYTES = 32 * 1024 * 1024;
    let resBuffer: ArrayBuffer;
    const contentLength = Number(upstreamRes.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_GIT_RESPONSE_BYTES) {
      return NextResponse.json(
        { error: "Réponse Git trop volumineuse (max 32 Mo)" },
        { status: 413 },
      );
    }
    if (upstreamRes.body) {
      const { readWithCap } = await import("@/lib/security/streaming");
      const { body, truncated } = await readWithCap(
        upstreamRes.body.getReader(),
        MAX_GIT_RESPONSE_BYTES,
      );
      if (truncated) {
        return NextResponse.json(
          { error: "Réponse Git trop volumineuse (max 32 Mo)" },
          { status: 413 },
        );
      }
      resBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    } else {
      resBuffer = new ArrayBuffer(0);
    }

    return new NextResponse(resBuffer, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: "Échec de la requête vers le dépôt Git distant",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const corsOrigin = allowedCorsOrigin(request.headers.get("origin"));
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": corsOrigin ?? "null",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Git-Protocol, User-Agent",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
