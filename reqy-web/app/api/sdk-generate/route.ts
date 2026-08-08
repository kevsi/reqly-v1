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

const DEFAULT_BASE = (
  process.env.OPENAPI_GENERATOR_URL ?? "https://api.openapi-generator.tech/api/gen/clients"
).replace(/\/+$/, "");

export const runtime = "nodejs";

export async function POST(req: Request) {
  let payload: {
    spec?: unknown;
    language?: string;
    options?: Record<string, unknown>;
    baseUrl?: string;
    apiName?: string;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { spec, language, options, baseUrl, apiName } = payload;
  if (!language || spec == null) {
    return Response.json({ error: "Missing 'language' or 'spec'" }, { status: 400 });
  }

  let safeBase: string;
  try {
    safeBase = await assertSafeBaseUrl((baseUrl || DEFAULT_BASE).replace(/\/+$/, ""));
  } catch {
    return Response.json({ error: "Invalid base URL" }, { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const genRes = await fetch(`${safeBase}/${language}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec, options: options ?? {} }),
      signal: controller.signal,
    });
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
    const portPart = dlParsed.port ? `:${dlParsed.port}` : "";
    const hostLiteral = isIP(resolvedDl) === 6 ? `[${resolvedDl}]` : resolvedDl;
    const pinnedDownloadUrl = `${dlParsed.protocol}//${hostLiteral}${portPart}${dlParsed.pathname}${dlParsed.search}`;

    const zipRes = await fetch(pinnedDownloadUrl, { signal: controller.signal });
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
    return Response.json({ error: "SDK generation failed" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
