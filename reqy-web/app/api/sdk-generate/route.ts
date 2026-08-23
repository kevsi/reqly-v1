export const dynamic = "force-dynamic";
/**
 * Proxies SDK generation to the OpenAPI Generator so the browser never calls
 * the third-party API directly (which fails with CORS / "Failed to fetch").
 * The server performs both the generation request and the ZIP download, then
 * streams the archive back to the client.
 *
 * `baseUrl` lets users point at a self-hosted generator instance.
 */
import { enrichZipWithManifests } from "@/lib/openapi-gen/sdk-manifests";
import { assertSafeBaseUrl } from "../proxy-ai/lib/url-utils";
import { isIP } from "node:net";
import { isBlockedIp } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";
import { createPinnedDispatcher } from "@/lib/security/pinned-dispatcher";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getRateLimitKey } from "../proxy-ai/lib/rate-limit";
import type { Agent } from "undici";
import type { NextRequest } from "next/server";

const DEFAULT_BASE = (
  process.env.OPENAPI_GENERATOR_URL ?? "https://api.openapi-generator.tech/api/gen/clients"
).replace(/\/+$/, "");

export const runtime = "nodejs";
const sdkRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_SPEC_BYTES = 512_000;

/** Errors raised by fetchGuarded that map to a 502 upstream response. */
class GuardedFetchError extends Error {}

/**
 * Fetch a URL with the SSRF guard applied at connect time: the socket is
 * pinned to the validated address (DNS-rebinding proof) and redirects are
 * never followed silently. When `allowRedirect` is set, at most one redirect
 * hop is followed after re-validating its destination.
 */
async function fetchGuarded(
  url: string,
  init: RequestInit,
  dispatchers: Agent[],
  allowRedirect = false,
): Promise<Response> {
  const dispatcher = await createPinnedDispatcher(url);
  if (dispatcher) dispatchers.push(dispatcher);
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (allowRedirect && res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (location) {
      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new GuardedFetchError("Redirect to invalid destination");
      }
      if (!["http:", "https:"].includes(target.protocol)) {
        throw new GuardedFetchError("Redirect to blocked destination: invalid protocol");
      }
      if (isIP(target.hostname) && isBlockedIp(target.hostname)) {
        throw new GuardedFetchError("Redirect to blocked destination: private/internal IP");
      }
      const resolved = await resolveCached(target.hostname);
      if (!resolved || isBlockedIp(resolved)) {
        throw new GuardedFetchError("Redirect to blocked destination: private/internal IP");
      }
      return fetchGuarded(
        target.toString(),
        { ...init, method: "GET", body: undefined },
        dispatchers,
        false,
      );
    }
  }
  return res;
}
const ALLOWED_LANGUAGES = new Set([
  "typescript-fetch",
  "typescript-axios",
  "javascript",
  "python",
  "java",
  "go",
  "csharp",
  "kotlin",
  "swift5",
  "rust",
  "php",
  "ruby",
  "dart",
]);

export async function POST(req: NextRequest) {
  const rate = await sdkRateLimiter.check(getRateLimitKey(req));
  if (!rate.allowed) {
    return Response.json(
      { error: "Trop de demandes de génération SDK. Réessayez plus tard." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }
  const requestLike = req as unknown as {
    headers?: { get: (name: string) => string | null };
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
  };
  const contentLength = Number(requestLike.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Corps de requête trop volumineux" }, { status: 413 });
  }
  let payload: {
    spec?: unknown;
    language?: string;
    options?: Record<string, unknown>;
    baseUrl?: string;
    apiName?: string;
  };
  try {
    if (typeof requestLike.text === "function") {
      const rawBody = await requestLike.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
        return Response.json({ error: "Corps de requête trop volumineux" }, { status: 413 });
      }
      payload = JSON.parse(rawBody) as typeof payload;
    } else if (typeof requestLike.json === "function") {
      payload = (await requestLike.json()) as typeof payload;
    } else {
      return Response.json({ error: "Impossible de lire le corps de la requête" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { spec, language, options, baseUrl, apiName } = payload;
  if (!language || spec == null) {
    return Response.json({ error: "Missing 'language' or 'spec'" }, { status: 400 });
  }
  if (!ALLOWED_LANGUAGES.has(language)) {
    return Response.json({ error: "Unsupported SDK language" }, { status: 400 });
  }
  let serializedSpec: string;
  try {
    serializedSpec = JSON.stringify(spec);
  } catch {
    return Response.json({ error: "Invalid OpenAPI specification" }, { status: 400 });
  }
  if (new TextEncoder().encode(serializedSpec).byteLength > MAX_SPEC_BYTES) {
    return Response.json({ error: "OpenAPI specification too large" }, { status: 413 });
  }

  let safeBase: string;
  try {
    safeBase = await assertSafeBaseUrl((baseUrl || DEFAULT_BASE).replace(/\/+$/, ""));
  } catch {
    return Response.json({ error: "Invalid base URL" }, { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  // Stop upstream work as soon as the client disconnects.
  req.signal?.addEventListener("abort", () => controller.abort());
  const dispatchers: Agent[] = [];

  try {
    const genRes = await fetchGuarded(
      `${safeBase}/${language}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, options: options ?? {} }),
        signal: controller.signal,
      },
      dispatchers,
    );
    if (!genRes.ok) {
      const text = await genRes.text().catch(() => "");
      return Response.json(
        { error: `OpenAPI Generator API error (${genRes.status}): ${text.slice(0, 500)}` },
        { status: 502 },
      );
    }

    const data = (await genRes.json()) as { link?: string };
    const link = data?.link;
    if (!link) {
      return Response.json(
        { error: "OpenAPI Generator returned no download link" },
        { status: 502 },
      );
    }

    // The download link is sometimes a relative path or served over http://;
    // resolve it against the generator origin so the server-side fetch works.
    const downloadUrl = /^https?:\/\//i.test(link)
      ? link
      : new URL(link, new URL(safeBase).origin).toString();

    const dlParsed = new URL(downloadUrl);
    if (!["http:", "https:"].includes(dlParsed.protocol)) {
      return Response.json({ error: "Invalid download URL protocol" }, { status: 400 });
    }
    if (isIP(dlParsed.hostname) && isBlockedIp(dlParsed.hostname)) {
      return Response.json({ error: "Blocked download destination" }, { status: 403 });
    }
    const resolvedDl = await resolveCached(dlParsed.hostname);
    if (!resolvedDl || isBlockedIp(resolvedDl)) {
      return Response.json({ error: "Blocked download destination" }, { status: 403 });
    }
    const zipRes = await fetchGuarded(
      downloadUrl,
      { signal: controller.signal },
      dispatchers,
      true,
    );
    if (!zipRes.ok) {
      return Response.json(
        { error: `Failed to download generated SDK (${zipRes.status})` },
        { status: 502 },
      );
    }

    const buf = await zipRes.arrayBuffer();

    // OpenAPI Generator does not emit build manifests for every target
    // (e.g. typescript-fetch ships without package.json/tsconfig.json).
    // Inject them so the downloaded SDK is usable out of the box. If the
    // ZIP is malformed or enrichment fails, fall back to the raw bytes.
    let finalBytes: BodyInit = buf;
    try {
      const specObj = spec as { info?: { title?: string }; servers?: { url?: string }[] };
      const basePath = Array.isArray(specObj?.servers) ? specObj.servers[0]?.url : undefined;
      finalBytes = await enrichZipWithManifests(
        buf,
        language,
        apiName || specObj?.info?.title || "api",
        basePath,
      );
    } catch {
      finalBytes = buf;
    }

    return new Response(finalBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${language}-sdk.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof GuardedFetchError) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "SDK generation failed";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
    await Promise.allSettled(dispatchers.map((d) => d.close()));
  }
}
