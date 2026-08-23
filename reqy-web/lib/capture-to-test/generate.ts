import { inferJsonSchema } from "@/lib/schema-diff/infer";
import type { Assertion } from "@/lib/test-runner/types";
import type { HttpMethod } from "@/lib/types";
// Import canonical CapturedRequest from tauri lib (single source of truth)
// headers shape: Array<[string, string]> — mirrors Rust serde camelCase output
export type { CapturedRequest } from "@/lib/tauri";
import type { CapturedRequest } from "@/lib/tauri";

/** A request ready to be saved into a collection (app `RequestItem` shape). */
export interface GeneratedRequest {
  name: string;
  method: HttpMethod;
  url: string;
  endpoint: string;
  headers?: Record<string, string>;
  body?: string;
  runnerAssertions: Assertion[];
}

/** A collection ready to be persisted via the app's collection store. */
export interface GeneratedCollection {
  name: string;
  description?: string;
  color: string;
  icon: string;
  requests: GeneratedRequest[];
}

/** Plain, editable bundle (mirrors recli's `ExportBundle` shape). */
export interface ExportBundle {
  version?: string;
  exportedAt?: string;
  collections: GeneratedCollection[];
}

/** Status codes considered successful, used as a fallback band. */
const SUCCESS_BAND = [200, 201, 202, 203, 204, 205, 206, 207, 208, 226];

function headersToRecord(
  headers: Array<[string, string]> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of headers) {
    if (key && key.length > 0) out[key] = value;
  }
  return out;
}

/**
 * (a) Status assertion from the observed response status.
 * When an exact status was captured we assert it; otherwise we fall back to a
 * generic 2xx success band (e.g. a proxy error with no response).
 */
function buildStatusAssertion(status: number | null): Assertion {
  if (status != null) {
    return { type: "status", expected: status };
  }
  return { type: "status", expected: { in: SUCCESS_BAND } };
}

/**
 * (b) presence of key body fields + (c) field types via `inferJsonSchema`.
 * Returns an empty list for non-JSON / empty / array bodies (we still emit the
 * status assertion separately so every request keeps >= 1 assertion).
 */
function buildBodyAssertions(responseBody: string | null): Assertion[] {
  if (!responseBody) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return [];
  }

  const assertions: Assertion[] = [];

  // (b) presence of top-level object keys
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const key of Object.keys(parsed as Record<string, unknown>)) {
      assertions.push({ type: "jsonPath", path: key, operator: "exists" });
    }
  }

  // (c) field types via the inferred JSON schema
  assertions.push({
    type: "schema",
    schema: inferJsonSchema(parsed) as Record<string, unknown>,
  });

  return assertions;
}

/**
 * Turn captured traffic into an editable collection bundle.
 *
 * Each captured request becomes one `RequestItem` carrying >= 1 inferred base
 * assertion: the observed status code, optional top-level field presence, and a
 * schema inferred from the response body. Everything is a plain object so the
 * user can edit it before saving.
 */
export function generateCollectionFromCapture(sessions: CapturedRequest[]): ExportBundle {
  const requests: GeneratedRequest[] = (sessions ?? []).map((c) => {
    const assertions: Assertion[] = [
      buildStatusAssertion(c.status),
      ...buildBodyAssertions(c.responseBody),
    ];

    return {
      name: `${c.method} ${c.url}`,
      method: c.method as HttpMethod,
      url: c.url,
      endpoint: c.url,
      headers: headersToRecord(c.headers),
      body: c.body ?? undefined,
      runnerAssertions: assertions,
    };
  });

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [
      {
        name: `Capture ${new Date().toLocaleString()}`,
        description: `Generated from ${requests.length} captured request(s)`,
        color: "emerald",
        icon: "package",
        requests,
      },
    ],
  };
}
