import type { HttpMethod, RequestTestAssertion, TestResult, AssertionType } from "@/lib/types";
export type { HttpMethod, RequestTestAssertion, TestResult } from "@/lib/types";
import type { Assertion, AssertionResult, RequestResponse } from "@/lib/test-runner/types";
import { evaluateAssertions } from "@/lib/test-runner/assertions";
import { interpolate, replaceLocalhostPort, parseJsonSafe } from "@/lib/utils";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import {
  invokeTauriFetch,
  isTauriInvokeError,
  type TauriCookie,
  type TauriErrorPayload,
} from "@/lib/tauri";
import { persistence } from "@/lib/persistence";
import { classifyError, enqueueOnNetworkFailure } from "@/lib/offline/queue";
import type { ResponseTimings } from "@/lib/types";
import type { ConsoleEntry } from "@/lib/test-runner/scripts";
import { applyPathParams, type PathParam } from "@/lib/path-params";
import i18n from "@/src/i18n";
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
  transportError?: TauriErrorPayload | null;
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
   * Follow HTTP redirects (3xx) through the proxy. Web mode only — the
   * desktop runtime follows redirects natively via reqwest.
   */
  followRedirects?: boolean;
  /**
   * Logs console.* des scripts pre/post request, pour l'onglet Console.
   */
  scriptLogs?: {
    pre: ConsoleEntry[];
    post: ConsoleEntry[];
  };
  /**
   * Key identifying the dataset row to use for data-driven execution.
   * Loaded from RequestItem.datasetKey via buildTabFromRequest; persisted
   * back via the save handlers. Optional and ignored by the live editor.
   */
  datasetKey?: string;
}

export const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Timeout de requête configurable (clé persistence `reqly_request_timeout_ms`).
 * Plafond haut : le proxy web coupe lui-même à 60 s ; en desktop natif les
 * 120 s sont réellement honorées.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const REQUEST_TIMEOUT_STORAGE_KEY = "reqly_request_timeout_ms";
const MIN_REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;

function resolveRequestTimeoutMs(): number {
  const stored = Number(persistence.getItem<number>(REQUEST_TIMEOUT_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(stored), MIN_REQUEST_TIMEOUT_MS), MAX_REQUEST_TIMEOUT_MS);
}

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
      if (!param.key?.trim() || !param.value?.trim()) return;
      // Use append instead of set so duplicate param keys are preserved
      finalUrl.searchParams.append(param.key.trim(), param.value.trim());
    });
    return finalUrl.toString();
  } catch {
    const params = queryParams
      .filter((param) => param.enabled !== false && param.key?.trim() && param.value?.trim())
      .map(
        (param) =>
          `${encodeURIComponent(param.key.trim())}=${encodeURIComponent(param.value.trim())}`,
      )
      .join("&");
    return normalizedUrl + (normalizedUrl.includes("?") ? "&" : "?") + params;
  }
};

export const buildHeaders = (headers: Header[], authType: AuthType, authToken?: string) => {
  const headerEntries: Array<[string, string]> = [];
  headers.forEach((header) => {
    // Skip disabled headers (enabled === false explicitly), or empty key/value
    if (header.enabled === false) return;
    if (!header.key?.trim() || !header.value?.trim()) return;
    headerEntries.push([header.key.trim(), header.value.trim()]);
  });

  const token = (authToken ?? "").trim();
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
  /** External AbortSignal (e.g. from a user cancel button). */
  signal?: AbortSignal;
}

function buildFormDataBody(body: string): { body: string; boundary: string } {
  const boundary = `----ReqlyFormBoundary${Math.random().toString(36).slice(2, 16)}`;

  // decodeURIComponent lève sur toute séquence % malformée ("a=100%") : on
  // dégrade en valeur littérale au lieu de faire échouer toute la requête.
  const safeDecode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const parts = body
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
      // La ligne Content-Disposition doit rester mono-ligne et sans guillemet
      // non échappé ; les valeurs, elles, peuvent contenir des retours à la
      // ligne (légal dans le corps d'une part multipart).
      const key = safeDecode(rawKey).replace(/[\r\n"]/g, "");
      const value = safeDecode(rawValue).replace(/\r\n/g, "\n");
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

/** Résultat normalisé d'une exécution de requête (web ou desktop). */
export interface RequestExecutionResult {
  responseStatus: number | undefined;
  responseHeaders: Record<string, string>;
  responseCookies: TauriCookie[];
  responseBody: string;
  responseData: string | Blob;
  responseSize: string;
  responseTime: number | undefined;
  responseTimings: ResponseTimings;
  transportError: TauriErrorPayload | null;
  testResults: TestResult[] | undefined;
}

/**
 * Traduit une erreur du proxy (`/api/proxy`) en message français actionnable.
 * Le détail technique brut est conservé pour le diagnostic.
 */
function translateProxyError(
  code: string | undefined,
  raw: string,
  url: string,
): { message: string; detail: string } {
  const detail = raw && raw !== "Proxy request failed" ? raw : "";
  switch (code) {
    case "RATE_LIMIT_EXCEEDED":
      return {
        message: "Trop de requêtes envoyées : patientez une minute avant de réessayer.",
        detail,
      };
    case "SSRF_BLOCKED":
      return {
        message: i18n.t("proxy.ssrfBlockedLocal", {
          defaultValue:
            "URL refusée par le proxy : localhost et adresses privées sont bloqués en mode web. En développement, utilise le mode dev ou définis ALLOW_LOCAL_HOSTS=true pour tester localhost.",
        }),
        detail,
      };
    case "INVALID_URL":
    case "DNS_ERROR":
      return {
        message:
          "URL de destination refusée par le proxy (adresse privée ou invalide) : vérifiez l'adresse demandée.",
        detail,
      };
    case "TARGET_UNREACHABLE":
      return {
        message: i18n.t("proxy.targetUnreachable", {
          defaultValue:
            "Serveur cible injoignable (connexion refusée ou DNS introuvable) — vérifie que le service tourne sur ce port et que l'URL est correcte.",
        }),
        detail,
      };
    case "CERTIFICATE_ERROR":
      return {
        message: i18n.t("proxy.certificateError", {
          defaultValue:
            "Certificat TLS invalide ou auto-signé — corrige le certificat du serveur cible (ou désactive la vérification SSL côté desktop pour tester).",
        }),
        detail,
      };
    case "TIMEOUT":
      return {
        message: "La requête a expiré (30 s) : le serveur cible est trop lent ou injoignable.",
        detail,
      };
    case "PROXY_AUTH_REQUIRED":
      return {
        message: "Session expirée : rechargez la page pour continuer.",
        detail,
      };
    case "BAD_GATEWAY":
    case "INTERNAL_ERROR":
      return {
        message: "Le proxy a rencontré une erreur : réessayez dans quelques instants.",
        detail,
      };
    default:
      return {
        message: `La requête vers ${url} a échoué. Vérifiez l'URL et votre connexion.`,
        detail,
      };
  }
}

export const executeRequest = async (
  context: ExecuteRequestContext,
): Promise<RequestExecutionResult> => {
  const { tab, nativeMode, activeWorkspaceId, signal: externalSignal } = context;
  const { finalUrl, finalBody, headers } = buildRequestPayload(context);

  const startedAt = performance.now();
  let responseBody: string;
  let responseData: string | Blob;
  let responseHeaders: Record<string, string> = {};
  let responseStatus: number | undefined;
  let responseSize: string;
  let responseTime: number | undefined;
  let proxyTimings: Partial<ResponseTimings> | undefined;
  let responseCookies: TauriCookie[] = [];
  let transportError: TauriErrorPayload | null = null;

  // SSL verification toggle (desktop only): when disabled, the Tauri fetch
  // uses the insecure reqwest client that skips certificate validation.
  const sslEnabled = persistence.getItem<boolean>("reqly_ssl_verification_enabled");
  const acceptInvalidCerts = sslEnabled === false;

  // Create an AbortController with the configured timeout (default 30 s,
  // réglable 5–120 s via la clé de persistence) to prevent hung requests.
  // An external signal (user cancel) aborts the same controller.
  const requestTimeoutMs = resolveRequestTimeoutMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    if (nativeMode) {
      // Tauri native mode — run with a race against the abort signal.
      // followRedirects: false explicite = reqwest NE suit PAS les 3xx
      // (audit E3 : le toggle était ignoré côté desktop).
      const result = await withTimeout(
        invokeTauriFetch(
          tab.method,
          finalUrl,
          headers,
          tab.method !== "GET" && tab.method !== "HEAD" ? finalBody : undefined,
          acceptInvalidCerts,
          tab.followRedirects === false ? false : undefined,
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
          // Le proxy accepte jusqu'à 60 s (clampé côté serveur) : on lui
          // transmet le timeout configuré au lieu du défaut silencieux.
          ...(requestTimeoutMs > DEFAULT_REQUEST_TIMEOUT_MS
            ? { "x-proxy-timeout": String(requestTimeoutMs) }
            : {}),
        } as unknown as Record<string, string>,
        body: JSON.stringify({
          url: finalUrl,
          method: tab.method,
          headers,
          body: tab.method !== "GET" && tab.method !== "HEAD" ? finalBody : undefined,
          workspaceId: activeWorkspaceId,
          followRedirects: tab.followRedirects === true,
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
          const binary = Uint8Array.from(
            atob(typeof proxyResult.body === "string" ? proxyResult.body : ""),
            (c) => c.charCodeAt(0),
          );
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
        // The proxy itself failed (timeout, blocked destination, rate limit…):
        // surface an actionable French message instead of the raw English one.
        const translated = translateProxyError(
          proxyResult.code,
          proxyError ?? "Proxy request failed",
          finalUrl,
        );
        transportError = {
          kind: "proxy",
          code: proxyResult.code || "unknown",
          message: translated.message,
          detail: translated.detail,
        };
        responseBody = translated.message;
        responseData = responseBody;
        responseSize = formatSize(new Blob([responseBody]).size);
      }
    }
  } catch (error) {
    if (isTauriInvokeError(error)) {
      transportError = {
        kind: error.kind,
        code: error.code,
        message: error.message,
        detail: error.detail,
      };
    } else if (error instanceof DOMException && error.name === "AbortError") {
      const cancelled = externalSignal?.aborted === true;
      transportError = {
        kind: "network",
        code: cancelled ? "cancelled" : "connection_timeout",
        message: cancelled ? i18n.t("request.cancelled") : i18n.t("request.transferTimeout"),
        detail: error.message || "AbortError",
      };
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      transportError = {
        kind: "network",
        code: "unknown",
        message: i18n.t("request.transferDefault"),
        detail,
      };
    }
    responseBody = "";
    responseData = "";
    responseStatus = 0;
    responseSize = "0 B";

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
        if (transportError) {
          transportError = {
            ...transportError,
            detail: `${transportError.detail}\nQueueing failed: ${queueMessage}`,
          };
        }
      });
    }
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }

  if (responseTime === undefined) {
    responseTime = Math.round(performance.now() - startedAt);
  }

  const responseTimings: ResponseTimings = {
    dnsMs: proxyTimings?.dnsMs,
    connectMs: proxyTimings?.connectMs,
    tlsMs: proxyTimings?.tlsMs,
    ttfbMs: proxyTimings?.ttfbMs,
    transferMs: proxyTimings?.transferMs,
    totalMs: responseTime ?? 0,
    transport: proxyTimings ? "proxy" : "native",
    uploadMs: proxyTimings?.uploadMs,
    requestBytes: proxyTimings?.requestBytes,
    responseBytes: proxyTimings?.responseBytes,
    connectionReused: proxyTimings?.connectionReused,
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
    transportError,
    testResults,
  };
};
