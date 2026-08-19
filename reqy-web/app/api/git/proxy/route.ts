export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isPrivateHost, isBlockedIp } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";
import { getServerEnv } from "@/lib/env";
import { isIP } from "node:net";

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

  return { valid: true, parsed };
}

export async function GET(request: NextRequest) {
  return handleGitProxy(request, "GET");
}

export async function POST(request: NextRequest) {
  return handleGitProxy(request, "POST");
}

async function handleGitProxy(request: NextRequest, method: "GET" | "POST") {
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

  let parsedUrl = urlValidation.parsed;
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

  try {
    let bodyToSend: ArrayBuffer | undefined = undefined;
    if (method === "POST") {
      bodyToSend = await request.arrayBuffer();
    }

    const upstreamRes = await fetch(targetUrl, {
      method,
      headers: headersToSend,
      body: bodyToSend,
      redirect: "manual",
    });

    // Transmettre la réponse binaire/texte avec les en-têtes appropriés
    const responseHeaders = new Headers();

    const allowedResponseHeaders = [
      "content-type",
      "content-length",
      "content-encoding",
      "git-protocol",
      "location",
      "www-authenticate",
    ];

    upstreamRes.headers.forEach((val, key) => {
      if (allowedResponseHeaders.includes(key.toLowerCase())) {
        responseHeaders.set(key, val);
      }
    });

    // CORS Headers pour le client web
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Git-Protocol, User-Agent",
    );
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    const resBuffer = await upstreamRes.arrayBuffer();

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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Git-Protocol, User-Agent",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
