import type { HttpMethod, RequestTestAssertion, TestResult, AssertionType } from "@/lib/types";
export type { HttpMethod, RequestTestAssertion, TestResult } from "@/lib/types";
import type { Assertion, AssertionResult, RequestResponse } from "@/lib/test-runner/types";
import { evaluateAssertions } from "@/lib/test-runner/assertions";
import { interpolate, replaceLocalhostPort, parseJsonSafe } from "@/lib/utils";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { invokeTauriFetch, type TauriCookie } from "@/lib/tauri";
import { persistence } from "@/lib/persistence";
import { classifyError, enqueueOnNetworkFailure } from "@/lib/offline/queue";
import type { ResponseTimings } from "@/components/response-timeline";
import { applyPathParams, type PathParam } from "@/lib/path-params";
export type BodyType = "json" | "form-data" | "x-www-form" | "raw" | "binary";
export type AuthType = "none" | "bearer" | "basic" | "api-key" | "oauth2";
export type { PathParam };

export interface QueryParam {
  key: string;
  value: string;
  enabled?: boolean;
}

export interface Header {
  key: string;
  value: string;
  enabled?: boolean;
}

export interface RequestTab {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  endpoint: string;
  headers: Header[];
  queryParams: QueryParam[];
  pathParams: PathParam[];
  body: string;
  bodyType: BodyType;
  authType: AuthType;
  authToken: string;
  hasResponse: boolean;
  isSaved: boolean;
  savedRequestId?: string;
  responseStatus?: number;
  responseTime?: number;
  responseSize?: string;
  responseBody?: string;
  responseData?: string | Blob;
  responseHeaders?: Record<string, string>;
  responseCookies?: TauriCookie[];
  responseTimings?: ResponseTimings;
  assertions?: RequestTestAssertion[];
  runnerAssertions?: Assertion[];
  preRequestScript?: string;
  postResponseScript?: string;
  protocol?: "rest" | "graphql";
  graphql?: {
    query: string;
    variables: string;
    operationName?: string;
  };
  testResults?: TestResult[];
  /**
   * Key identifying the dataset row to use for data-driven execution.
   * Loaded from RequestItem.datasetKey via buildTabFromRequest; persisted
   * back via the save handlers. Optional and ignored by the live editor.
   */
  datasetKey?: string;
}

export const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  return `${Math.round(size / 1024)} KB`;
};

export const sanitizeUrl = (url: string) => {
  let sanitized = url.trim();
  sanitized = sanitized.replace(/%20/gi, " ");
  sanitized = sanitized.replace(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)(?:\s+|%20)+/i, "");
  sanitized = sanitized.replace(/^(https?:)\/(?!\/)/i, "$1//");
  sanitized = sanitized.replace(/^(https?:)\/{3,}(\/)?/i, "$1//");
  return sanitized;
};

function toTestResults(results: AssertionResult[]): TestResult[] {
  return results.map((r, i) => {
    const a = r.assertion;
    let target: string = a.type;
    let expected = "";
    switch (a.type) {
      case "status":
        target = "status";
        expected = JSON.stringify(a.expected);
        break;
      case "responseTime":
        target = "response time";
        expected = `${a.operator} ${a.valueMs}ms`;
        break;
      case "jsonPath":
        target = a.path;
        expected = `${a.operator}${a.value !== undefined ? ` ${JSON.stringify(a.value)}` : ""}`;
        break;
      case "schema":
        target = "schema";
        expected = "schema validation";
        break;
    }
    return {
      assertionId: `${a.type}-${i}`,
      type: a.type as AssertionType,
      target,
      expected,
      passed: r.passed,
      message:
        r.error ??
        (r.passed
          ? "Assertion passed"
          : `Expected ${expected}, got ${JSON.stringify(r.actualValue)}`),
    };
  });
}

export const normalizeUrl = (url: string) => {
  const sanitizedUrl = sanitizeUrl(url);

  if (sanitizedUrl.startsWith("//")) {
    return `https:${sanitizedUrl}`;
  }

  if (!/^https?:\/\//i.test(sanitizedUrl)) {
    const localhostLike = /^(localhost|127(?:\.[0-9]{1,3}){0,3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(
      sanitizedUrl,
    );
    const ipLike = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::\d+)?(?:[/?#]|$)/.test(sanitizedUrl);
    const hostLike = /^[^/?#\s]+\.[^/?#\s]+/.test(sanitizedUrl);

    if (localhostLike || ipLike) {
      return `http://${sanitizedUrl}`;
    }
    if (hostLike) {
      return `https://${sanitizedUrl}`;
    }
  }

  return sanitizedUrl;
};

export const buildUrl = (url: string, queryParams: QueryParam[], pathParams?: PathParam[]) => {
  const withPathParams = pathParams ? applyPathParams(url, pathParams) : url;
  const normalizedUrl = normalizeUrl(withPathParams);

  try {
    const finalUrl = new URL(normalizedUrl);
    queryParams.forEach((param) => {
      // Skip disabled params (enabled === false explicitly), or empty key/value
      if (param.enabled === false) return;
      if (!param.key.trim() || !param.value.trim()) return;
      // Use append instead of set so duplicate param keys are preserved
      finalUrl.searchParams.append(param.key.trim(), param.value.trim());
    });
    return finalUrl.toString();
  } catch {
    const params = queryParams
      .filter((param) => param.enabled !== false && param.key.trim() && param.value.trim())
      .map(
        (param) =>
          `${encodeURIComponent(param.key.trim())}=${encodeURIComponent(param.value.trim())}`,
      )
      .join("&");
    return normalizedUrl + (normalizedUrl.includes("?") ? "&" : "?") + params;
  }
};

export const buildHeaders = (headers: Header[], authType: AuthType, authToken: string) => {
  const headerEntries: Array<[string, string]> = [];
  headers.forEach((header) => {
    // Skip disabled headers (enabled === false explicitly), or empty key/value
    if (header.enabled === false) return;
    if (!header.key.trim() || !header.value.trim()) return;
    headerEntries.push([header.key.trim(), header.value.trim()]);
  });

  const token = authToken.trim();
  if (token && authType !== "none") {
    if (authType === "bearer" || authType === "oauth2") {
      headerEntries.push(["Authorization", `Bearer ${token}`]);
    } else if (authType === "basic") {
      headerEntries.push(["Authorization", `Basic ${token}`]);
    } else if (authType === "api-key") {
      headerEntries.push(["x-api-key", token]);
    }
  }

  return Object.fromEntries(headerEntries);
};

export interface ExecuteRequestContext {
  tab: RequestTab;
  allVars: { key: string; value: string; enabled: boolean }[];
  activeProjectPort: number;
  activeProject: boolean;
  nativeMode: boolean;
  activeWorkspaceId: string | null;
}

function buildFormDataBody(body: string): { body: string; boundary: string } {
  const boundary = `----ReqlyFormBoundary${Math.random().toString(36).slice(2, 16)}`;
  const parts = body
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
      const value = decodeURIComponent(eq === -1 ? "" : pair.slice(eq + 1));
      return `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}`;
    });
  parts.push(`--${boundary}--`);
  return { body: parts.join("\r\n"), boundary };
}

export const buildRequestPayload = (context: ExecuteRequestContext) => {
  const { tab, allVars, activeProjectPort, activeProject } = context;
  const resolvedUrl = activeProject ? replaceLocalhostPort(tab.url, activeProjectPort) : tab.url;
  const rawUrl = buildUrl(resolvedUrl, tab.queryParams, tab.pathParams);
  const rawHeaders = buildHeaders(tab.headers, tab.authType, tab.authToken);
  const rawBody = tab.body || "";

  const finalUrl = interpolate(rawUrl, allVars);
  let finalBody = interpolate(rawBody, allVars);
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).map(([key, value]) => [
      interpolate(key, allVars),
      interpolate(value, allVars),
    ]),
  );

  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");

  if (!hasContentType && tab.body && tab.bodyType) {
    if (tab.bodyType === "json") {
      headers["Content-Type"] = "application/json";
    } else if (tab.bodyType === "x-www-form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (tab.bodyType === "form-data") {
      const mp = buildFormDataBody(finalBody);
      finalBody = mp.body;
      headers["Content-Type"] = `multipart/form-data; boundary=${mp.boundary}`;
    } else if (tab.bodyType === "raw") {
      headers["Content-Type"] = "text/plain";
    } else if (tab.bodyType === "binary") {
      headers["Content-Type"] = "application/octet-stream";
    }
  }

  return { finalUrl, finalBody, headers };
};

/**
 * Race a promise against an AbortSignal.
 * Throws DOMException('AbortError') if the signal fires before the promise settles.
 */
async function withTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("AbortError", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("AbortError", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export const executeRequest = async (context: ExecuteRequestContext) => {
  const { tab, nativeMode, activeWorkspaceId } = context;
  const { finalUrl, finalBody, headers } = buildRequestPayload(context);

  const startedAt = performance.now();
  let responseBody: string;
  let responseData: string | Blob;
  let responseHeaders: Record<string, string> = {};
  let responseStatus: number | undefined;
  let responseSize = "0 B";
  let responseTime: number | undefined;
  let proxyTimings: { dnsMs?: number; connectMs?: number; ttfbMs?: number } | undefined;
  let responseCookies: TauriCookie[] = [];

  // SSL verification toggle (desktop only): when disabled, the Tauri fetch
  // uses the insecure reqwest client that skips certificate validation.
  const sslEnabled = persistence.getItem<boolean>("reqly_ssl_verification_enabled");
  const acceptInvalidCerts = sslEnabled === false;

  // Create an AbortController with a 30-second timeout to prevent hung requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    if (nativeMode) {
      // Tauri native mode — run with a race against the abort signal
      const result = await withTimeout(
        invokeTauriFetch(
          tab.method,
          finalUrl,
          headers,
          tab.method !== "GET" && tab.method !== "HEAD" ? finalBody : undefined,
          acceptInvalidCerts,
        ),
        controller.signal,
      );
      responseStatus = result.status;
      responseHeaders = result.headers;
      responseTime = result.durationMs;
      responseCookies = result.cookies ?? [];

      if (result.encoding === "base64") {
        const contentType =
          responseHeaders["content-type"] ||
          responseHeaders["Content-Type"] ||
          "application/octet-stream";
        const binary = Uint8Array.from(atob(result.body), (c) => c.charCodeAt(0));
        responseBody = "[binary data]";
        responseData = new Blob([binary], { type: contentType.split(";")[0].trim() });
        responseSize = formatSize(responseData.size);
      } else {
        responseBody = result.body;
        responseData = result.body;
        responseSize = formatSize(new Blob([responseBody]).size);
      }
    } else {
      const debugHeaders =
        typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production"
          ? { "x-proxy-debug": "1" }
          : {};

      const proxyResponse = await fetch("/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...debugHeaders,
          ...proxyAuthHeaders(),
          ...(activeWorkspaceId ? { "x-workspace-id": activeWorkspaceId } : {}),
        } as unknown as Record<string, string>,
        body: JSON.stringify({
          url: finalUrl,
          method: tab.method,
          headers,
          body: tab.method !== "GET" && tab.method !== "HEAD" ? finalBody : undefined,
          workspaceId: activeWorkspaceId,
        }),
        signal: controller.signal,
      });

      const proxyResult = await parseJsonSafe(proxyResponse);
      proxyTimings = proxyResult.timings;
      responseStatus = proxyResult.status ?? proxyResponse.status ?? 0;
      responseHeaders = proxyResult.headers || {};
      responseCookies = proxyResult.cookies ?? [];

      const proxyError =
        proxyResult.error ||
        (!proxyResponse.ok ? proxyResponse.statusText || "Proxy request failed" : undefined);

      if (proxyResponse.ok) {
        if (proxyResult.encoding === "base64") {
          const contentType =
            responseHeaders["content-type"] ||
            responseHeaders["Content-Type"] ||
            "application/octet-stream";
          const binary = Uint8Array.from(atob(proxyResult.body ?? ""), (c) => c.charCodeAt(0));
          responseBody = "[binary data]";
          responseData = new Blob([binary], { type: contentType });
          responseSize = formatSize(responseData.size);
        } else {
          responseBody =
            typeof proxyResult.body === "string"
              ? proxyResult.body
              : String(proxyResult.body ?? "");
          responseData = responseBody;
          responseSize = formatSize(new Blob([responseBody]).size);
        }
      } else {
        responseBody = proxyError ?? "Proxy request failed";
        responseData = responseBody;
        responseSize = formatSize(new Blob([responseBody]).size);
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      responseBody = "Error: Request timed out after 30 seconds";
    } else {
      responseBody = error instanceof Error ? `Error: ${error.message}` : String(error);
    }
    responseData = responseBody;
    responseStatus = 0;

    // Store-and-forward: a genuine network failure (no HTTP response was
    // produced) is queued for automatic replay when connectivity returns.
    // Application errors (4xx/5xx) keep a real status and are never queued.
    if (classifyError(error) === "network") {
      await enqueueOnNetworkFailure(
        {
          method: tab.method,
          url: finalUrl,
          headers,
          body: finalBody || undefined,
        },
        { error },
      ).catch((queueError) => {
        const queueMessage =
          queueError instanceof Error
            ? queueError.message
            : String(queueError ?? "unknown queue error");
        responseBody = `Error: ${responseBody}\nQueueing failed: ${queueMessage}`;
        responseData = responseBody;
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (responseTime === undefined) {
    responseTime = Math.round(performance.now() - startedAt);
  }

  const responseTimings: ResponseTimings = {
    dnsMs: proxyTimings?.dnsMs,
    connectMs: proxyTimings?.connectMs,
    ttfbMs: proxyTimings?.ttfbMs,
    totalMs: responseTime ?? 0,
  };

  let testResults: TestResult[] | undefined;
  const runnerAssertions = context.tab.runnerAssertions;
  if (runnerAssertions && runnerAssertions.length > 0) {
    let parsedBody: unknown = responseBody ?? "";
    if (typeof responseBody === "string") {
      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        /* keep raw string when not JSON */
      }
    }
    const evalResponse: RequestResponse = {
      statusCode: responseStatus ?? 0,
      responseTimeMs: responseTime ?? 0,
      body: parsedBody,
      headers: responseHeaders ?? {},
    };
    testResults = toTestResults(evaluateAssertions(runnerAssertions, evalResponse));
  }

  return {
    responseStatus,
    responseHeaders,
    responseCookies,
    responseBody,
    responseData,
    responseSize,
    responseTime,
    responseTimings,
    testResults,
  };
};
