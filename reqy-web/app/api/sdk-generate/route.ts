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

  const base = (baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const genRes = await fetch(`${base}/${language}`, {
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
      : new URL(link, new URL(base).origin).toString();

    const zipRes = await fetch(downloadUrl, { signal: controller.signal });
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
      finalBytes = await enrichZipWithManifests(buf, language, apiName || specObj?.info?.title || "api", basePath);
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
    const message = err instanceof Error ? err.message : "SDK generation failed";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
