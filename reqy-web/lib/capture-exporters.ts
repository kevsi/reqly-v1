/**
 * Exporters for Captured HTTP Traffic
 * - HAR 1.2 (HTTP Archive)
 * - OpenAPI 3.0.3 Specification
 * - cURL Command Generator
 * - Mock Server Bundle Generator
 */

import type { CapturedRequest } from "@/lib/tauri";
import { inferJsonSchema } from "@/lib/schema-diff/infer";

/** Converts key-value header array [string, string][] to Record or HAR header format */
function headersToHarPairs(
  headers: Array<[string, string]> | null | undefined,
): Array<{ name: string; value: string }> {
  if (!headers) return [];
  return headers.map(([name, value]) => ({ name, value }));
}

function headersToRecord(
  headers: Array<[string, string]> | null | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  if (!headers) return record;
  for (const [k, v] of headers) {
    if (k) record[k] = v;
  }
  return record;
}

/**
 * Export captured requests as HAR 1.2 JSON structure
 */
export function exportCaptureAsHar(
  sessions: CapturedRequest[],
  creatorName = "Reqly Traffic Capture",
): string {
  const entries = sessions.map((s) => {
    const requestHeaders = headersToHarPairs(s.headers);
    const responseHeaders = headersToHarPairs(s.responseHeaders);

    const reqBodySize = s.body ? s.body.length : 0;
    const resBodySize = s.responseBody ? s.responseBody.length : 0;

    return {
      startedDateTime: new Date(s.timestamp).toISOString(),
      time: s.durationMs ?? 0,
      request: {
        method: s.method.toUpperCase(),
        url: s.url,
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: requestHeaders,
        queryString: [],
        postData: s.body
          ? {
              mimeType:
                requestHeaders.find((h) => h.name.toLowerCase() === "content-type")?.value ||
                "application/json",
              text: s.body,
            }
          : undefined,
        headersSize: -1,
        bodySize: reqBodySize,
      },
      response: {
        status: s.status ?? 200,
        statusText: s.status ? (s.status >= 400 ? "Error" : "OK") : "OK",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: responseHeaders,
        content: {
          size: resBodySize,
          mimeType:
            responseHeaders.find((h) => h.name.toLowerCase() === "content-type")?.value ||
            "application/json",
          text: s.responseBody || "",
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: resBodySize,
      },
      cache: {},
      timings: {
        send: 0,
        wait: s.durationMs ?? 0,
        receive: 0,
      },
    };
  });

  const har = {
    log: {
      version: "1.2",
      creator: {
        name: creatorName,
        version: "1.0.0",
      },
      entries,
    },
  };

  return JSON.stringify(har, null, 2);
}

/**
 * Export captured requests as OpenAPI 3.0.3 Specification JSON
 */
export function exportCaptureAsOpenApi(
  sessions: CapturedRequest[],
  title = "Captured API Specification",
): object {
  const paths: Record<string, Record<string, object>> = {};

  for (const s of sessions) {
    let pathname = "/";
    try {
      const urlObj = new URL(s.url);
      pathname = urlObj.pathname || "/";
    } catch {
      pathname = s.url || "/";
    }

    if (!paths[pathname]) {
      paths[pathname] = {};
    }

    const method = s.method.toLowerCase();
    const reqHeaders = headersToRecord(s.headers);
    const resHeaders = headersToRecord(s.responseHeaders);

    // Request body schema inference
    let requestBodyObj: object | undefined;
    if (s.body) {
      try {
        const parsed = JSON.parse(s.body);
        requestBodyObj = {
          required: true,
          content: {
            [reqHeaders["content-type"] || "application/json"]: {
              schema: inferJsonSchema(parsed),
            },
          },
        };
      } catch {
        requestBodyObj = {
          content: {
            "text/plain": {
              schema: { type: "string" },
            },
          },
        };
      }
    }

    // Response schema inference
    let responseSchema: object = { type: "string" };
    if (s.responseBody) {
      try {
        const parsedRes = JSON.parse(s.responseBody);
        responseSchema = inferJsonSchema(parsedRes) as object;
      } catch {
        responseSchema = { type: "string" };
      }
    }

    const statusCode = s.status ? String(s.status) : "200";

    paths[pathname][method] = {
      summary: `${s.method.toUpperCase()} ${pathname}`,
      description: `Captured endpoint from ${s.url}`,
      requestBody: requestBodyObj,
      responses: {
        [statusCode]: {
          description: `Response code ${statusCode}`,
          content: {
            [resHeaders["content-type"] || "application/json"]: {
              schema: responseSchema,
            },
          },
        },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title,
      version: "1.0.0",
      description: "Auto-generated OpenAPI specification from captured HTTP traffic.",
    },
    paths,
  };
}

/**
 * Generate a cURL command string from a captured request
 */
export function capturedToCurl(session: CapturedRequest): string {
  const parts: string[] = [`curl -X ${session.method.toUpperCase()} "${session.url}"`];

  if (session.headers) {
    for (const [key, val] of session.headers) {
      if (key && !key.startsWith(":")) {
        parts.push(`-H "${key}: ${val.replace(/"/g, '\\"')}"`);
      }
    }
  }

  if (session.body) {
    parts.push(`--data "${session.body.replace(/"/g, '\\"')}"`);
  }

  return parts.join(" \\\n  ");
}

/**
 * Export captured sessions as a Mock Server Bundle JSON
 */
export function exportCaptureAsMockBundle(sessions: CapturedRequest[]): object {
  const mocks = sessions.map((s) => ({
    id: s.id,
    name: `${s.method.toUpperCase()} ${s.url}`,
    request: {
      method: s.method.toUpperCase(),
      url: s.url,
      headers: headersToRecord(s.headers),
    },
    response: {
      status: s.status ?? 200,
      headers: headersToRecord(s.responseHeaders),
      body: s.responseBody || "",
    },
  }));

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    mocks,
  };
}
