import { isTauriAvailable } from "@/lib/tauri";
import { enrichZipWithManifests } from "@/lib/openapi-gen/sdk-manifests";

/**
 * Generated SDK client using the hosted OpenAPI Generator API.
 *
 * POSTs an OpenAPI spec to https://api.openapi-generator.tech and returns
 * the generated ZIP as a Blob for download.
 */

export const OPENAPI_GEN_URL = "https://api.openapi-generator.tech/api/gen/clients";

export interface GenerateResult {
  /** The raw ZIP blob */
  blob: Blob;
  /** Suggested filename e.g. "my-api-typescript-fetch.zip" */
  filename: string;
  /** The generator name used (e.g. "typescript-fetch", "python") */
  generator: string;
}

export interface GenerateOptions {
  /** Override the OpenAPI Generator base URL (defaults to the hosted cloud API).
   *  Point this at a self-hosted instance to keep specs on your own network. */
  baseUrl?: string;
  /** Request timeout in ms (default 120000). */
  timeoutMs?: number;
  /** Options forwarded to the OpenAPI Generator (e.g. `{ supportsES6: true }`). */
  generatorOptions?: Record<string, unknown>;
}

/** Map user-facing labels to OpenAPI Generator identifiers. */
export const GENERATORS: Record<string, string> = {
  TypeScript: "typescript-fetch",
  Python: "python",
  Go: "go",
  Java: "java",
  "C#": "csharp",
  Rust: "rust",
  PHP: "php",
  Kotlin: "kotlin",
  Swift: "swift5",
  Ruby: "ruby",
  Dart: "dart",
};

export const AVAILABLE_LANGUAGES = Object.keys(GENERATORS);

/**
 * Generate an SDK from an OpenAPI spec using the OpenAPI Generator.
 *
 * On desktop (Tauri static export), Next.js API routes are not available,
 * so the OpenAPI Generator is called directly. On the web build, the request
 * is proxied through the same-origin `/api/sdk-generate` route to avoid CORS
 * and mixed-content failures (the generator returns an `http://` download
 * link that the browser/Webview refuses to fetch directly).
 *
 * @param spec     The full OpenAPI spec object (v3)
 * @param language The generator name e.g. "typescript-fetch", "python"
 * @param apiName  Optional. Used in filename suggestion.
 * @returns        A GenerateResult with the ZIP blob.
 */
export async function generateSdk(
  spec: unknown,
  language: string,
  apiName = "api",
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  if (isTauriAvailable()) {
    return generateDirect(spec, language, apiName, options);
  }
  return generateViaRoute(spec, language, apiName, options);
}

/**
 * Call the OpenAPI Generator API directly from the client.
 * Used in desktop (Tauri) mode where Next.js API routes are unavailable.
 */
async function generateDirect(
  spec: unknown,
  language: string,
  apiName: string,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const base = (options.baseUrl || OPENAPI_GEN_URL).replace(/\/+$/, "");
  let link: string;
  let rawBuffer: ArrayBuffer;

  if (isTauriAvailable()) {
    const { invokeTauriFetch } = await import("@/lib/tauri");

    // Step 1: POST spec to the generator API via Tauri Rust backend
    const genRes = await invokeTauriFetch(
      "POST",
      `${base}/${language}`,
      { "Content-Type": "application/json" },
      JSON.stringify({ spec, options: options.generatorOptions ?? {} }),
    );

    if (genRes.status < 200 || genRes.status >= 300) {
      throw new Error(
        `OpenAPI Generator API error (${genRes.status}): ${genRes.body.slice(0, 500)}`,
      );
    }

    let data: { link?: string };
    try {
      data = JSON.parse(genRes.body);
    } catch {
      throw new Error("Invalid JSON response from OpenAPI Generator");
    }

    if (!data?.link) {
      throw new Error("OpenAPI Generator returned no download link");
    }
    link = data.link;

    // Step 2: Download the generated ZIP via Tauri Rust backend
    const downloadUrl = /^https?:\/\//i.test(link)
      ? link
      : new URL(link, new URL(base).origin).toString();

    const zipRes = await invokeTauriFetch("GET", downloadUrl, {});
    if (zipRes.status < 200 || zipRes.status >= 300) {
      throw new Error(`Failed to download generated SDK (${zipRes.status})`);
    }

    if (zipRes.encoding === "base64") {
      const binaryString = atob(zipRes.body);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      rawBuffer = bytes.buffer as ArrayBuffer;
    } else {
      rawBuffer = new TextEncoder().encode(zipRes.body).buffer as ArrayBuffer;
    }
  } else {
    // Fallback for non-Tauri direct generation
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
    try {
      const genRes = await fetch(`${base}/${language}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, options: options.generatorOptions ?? {} }),
        signal: controller.signal,
      });
      if (!genRes.ok) {
        const text = await genRes.text().catch(() => "");
        throw new Error(`OpenAPI Generator API error (${genRes.status}): ${text.slice(0, 500)}`);
      }
      const data = (await genRes.json()) as { link?: string };
      if (!data?.link) throw new Error("OpenAPI Generator returned no download link");
      link = data.link;

      let downloadUrl = /^https?:\/\//i.test(link)
        ? link
        : new URL(link, new URL(base).origin).toString();

      if (
        typeof window !== "undefined" &&
        window.location.protocol === "https:" &&
        downloadUrl.startsWith("http://")
      ) {
        downloadUrl = downloadUrl.replace(/^http:\/\//i, "https://");
      }

      const zipRes = await fetch(downloadUrl, { signal: controller.signal });
      if (!zipRes.ok) throw new Error(`Failed to download generated SDK (${zipRes.status})`);
      rawBuffer = await zipRes.arrayBuffer();
    } finally {
      clearTimeout(timeout);
    }
  }

  // Enrich the ZIP with build manifests (package.json, tsconfig.json, etc.)
  // OpenAPI Generator does not emit these for every target, so we inject
  // them so the SDK is usable out of the box. Falls back to raw bytes on error.
  const specObj = spec as { info?: { title?: string }; servers?: { url?: string }[] };
  let enriched: Uint8Array | ArrayBuffer = rawBuffer;
  try {
    enriched = await enrichZipWithManifests(
      rawBuffer,
      language,
      apiName,
      Array.isArray(specObj?.servers) ? specObj.servers[0]?.url : undefined,
    );
  } catch {
    // enrichment is best-effort — keep raw bytes
  }

  const blob = new Blob([enriched], { type: "application/zip" });
  const safeName = apiName.replace(/\s+/g, "-").toLowerCase();
  return { blob, filename: `${safeName}-${language}.zip`, generator: language };
}

/**
 * Proxy the SDK generation through the same-origin `/api/sdk-generate` route.
 * This avoids CORS issues and mixed-content errors in web builds.
 */
async function generateViaRoute(
  spec: unknown,
  language: string,
  apiName: string,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
  let response: Response;
  try {
    response = await fetch("/api/sdk-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec,
        language,
        options: options.generatorOptions ?? {},
        baseUrl: options.baseUrl,
        apiName,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`SDK generation timed out after ${options.timeoutMs ?? 120000}ms.`, {
        cause: err,
      });
    }
    throw new Error("Could not reach the SDK generation endpoint. Is the app server running?", {
      cause: err,
    });
  }
  clearTimeout(timeout);

  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { error?: string };
      detail = data?.error ? `: ${data.error}` : "";
    } catch {
      // ignore — fall through to the generic status message
    }
    throw new Error(`SDK generation failed (${response.status})${detail}`);
  }

  const blob = await response.blob();
  const safeName = apiName.replace(/\s+/g, "-").toLowerCase();
  return { blob, filename: `${safeName}-${language}.zip`, generator: language };
}
