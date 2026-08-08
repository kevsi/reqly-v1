import {
  executeRequest as cliExecuteRequest,
  isUrlAllowed,
  readBodyWithCap,
  DEFAULT_MAX_RESPONSE_SIZE,
} from "../runner.js";
import { interpolate } from "../chaining.js";
import { evaluateAssertions, runResultToAssertionContext } from "./assertions.js";
import type {
  RequestItem,
  HttpMethod,
  RunResult,
  RunnerOptions,
  AssertionResult,
} from "./types.js";

export const VALID_METHODS: ReadonlyArray<string> = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

function buildEnvVarMap(
  environments: Array<{
    name: string;
    variables: Array<{ key: string; value: string; enabled: boolean }>;
  }>,
  envName?: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (envName && environments) {
    const env = environments.find((e) => e.name.toLowerCase() === envName.toLowerCase());
    if (env && env.variables) {
      for (const v of env.variables) {
        if (v.enabled) map.set(v.key, v.value);
      }
    }
  }
  return map;
}

/** Coerce GraphQLConfig.variables (Record | string) vers Record pour l'exécution. */
function normalizeVariables(
  v?: string | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      // ponytail: variables invalides -> {} plutôt que de faire échouer le run
      // (le runner CLI, lui, propage l'erreur de parse — divergence assumée ici
      // car MCP doit être robuste face à des arguments fournis par un agent).
      return {};
    }
  }
  return v;
}

export async function executeRequest(
  request: RequestItem,
  options: RunnerOptions,
  environments?: Array<{
    name: string;
    variables: Array<{ key: string; value: string; enabled: boolean }>;
  }>,
): Promise<RunResult> {
  if (request.method === "GRAPHQL") {
    const envVars = buildEnvVarMap(environments ?? [], options.envName);
    const gqlCtx = {
      vars: envVars,
      envVars,
      cookies: new Map<string, string>(),
      iteration: 0,
      disableProcessEnv: true,
    };
    const url = interpolate(request.url, gqlCtx, new Map());
    const urlCheck = await isUrlAllowed(url, options.allowLocalHosts);
    if (!urlCheck.allowed) {
      return {
        name: request.name,
        method: request.method,
        url,
        status: 0,
        statusText: "Blocked",
        durationMs: 0,
        size: 0,
        passed: false,
        error: urlCheck.reason,
      };
    }
    const query = request.graphql?.query ?? request.body ?? "";
    return executeGraphQL(
      url,
      query,
      normalizeVariables(request.graphql?.variables),
      request.graphql?.operationName,
      request.headers,
      options,
    );
  }

  const envVars = buildEnvVarMap(environments ?? [], options.envName);
  const ctx = {
    vars: envVars,
    envVars,
    cookies: new Map<string, string>(),
    iteration: 0,
    disableProcessEnv: true,
  };

  // Resolve {{vars}} BEFORE the SSRF check: a raw URL with unresolved variables
  // (e.g. "{{BASE_URL}}/posts") cannot be validated and would be blocked as
  // "Invalid URL" even though the resolved URL is perfectly fine.
  const resolvedUrl = interpolate(request.url, ctx, new Map());
  const urlCheck = await isUrlAllowed(resolvedUrl, options.allowLocalHosts);
  if (!urlCheck.allowed) {
    return {
      name: request.name,
      method: request.method,
      url: resolvedUrl,
      status: 0,
      statusText: "Blocked",
      durationMs: 0,
      size: 0,
      passed: false,
      error: urlCheck.reason,
    };
  }

  const result = await cliExecuteRequest(
    {
      name: request.name,
      method: request.method as any,
      url: request.url,
      headers: request.headers,
      body: request.body,
      bodyType: request.bodyType as any,
      authType: request.authType as any,
      authToken: request.authToken,
      queryParams: request.queryParams as any,
      graphql: request.graphql as any,
    },
    ctx,
    options.timeoutMs,
    {
      timeoutMs: options.timeoutMs,
      allowLocalHosts: options.allowLocalHosts,
      maxResponseSize: options.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE,
    },
  );

  return {
    name: result.name,
    method: result.method as HttpMethod,
    url: result.url,
    status: result.status,
    statusText: result.statusText,
    durationMs: result.durationMs,
    size: result.size,
    passed: result.passed,
    error: result.error,
    body: result.body,
    responseHeaders: result.responseHeaders,
    responseCookies: result.responseCookies,
  };
}

export interface RunResultWithAssertions extends RunResult {
  assertionResults?: AssertionResult[];
  assertionsPassed?: boolean;
}

export async function executeRequestWithAssertions(
  request: RequestItem,
  options: RunnerOptions,
  environments?: Array<{
    name: string;
    variables: Array<{ key: string; value: string; enabled: boolean }>;
  }>,
): Promise<RunResultWithAssertions> {
  const result = await executeRequest(request, options, environments);
  const assertions = request.runnerAssertions?.filter((a) => a.enabled !== false);
  if (!assertions || assertions.length === 0) {
    return result;
  }

  const assertionResults = evaluateAssertions(assertions, runResultToAssertionContext(result));
  const assertionsPassed = assertionResults.every((r) => r.passed);

  return {
    ...result,
    passed: result.passed && assertionsPassed,
    assertionResults,
    assertionsPassed,
  };
}

export async function executeGraphQL(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string,
  headers?: Record<string, string>,
  options: RunnerOptions = { timeoutMs: 30000 },
): Promise<RunResult> {
  const urlCheck = await isUrlAllowed(url, options.allowLocalHosts);
  if (!urlCheck.allowed) {
    return {
      name: "GraphQL",
      method: "GRAPHQL" as HttpMethod,
      url,
      status: 0,
      statusText: "Blocked",
      durationMs: 0,
      size: 0,
      passed: false,
      error: urlCheck.reason,
    };
  }

  const body = JSON.stringify({
    query,
    variables: variables ?? {},
    operationName: operationName ?? undefined,
  });

  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers ?? {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startTime = Date.now();
  const maxSize = options.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE;

  try {
    // Follow redirects manually, re-checking SSRF on every hop (same policy as
    // the CLI httpFetch — redirect: "follow" would silently follow a 302 to a
    // private/internal address after the initial isUrlAllowed check).
    let response = await fetch(url, {
      method: "POST",
      headers: reqHeaders,
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    let currentUrl = url;
    let hops = 0;
    while ([301, 302, 303, 307, 308].includes(response.status) && hops < 10) {
      const location = response.headers.get("location");
      if (!location) break;
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        break;
      }
      const hopCheck = await isUrlAllowed(currentUrl, options.allowLocalHosts);
      if (!hopCheck.allowed) {
        return {
          name: "GraphQL",
          method: "GRAPHQL" as HttpMethod,
          url,
          status: 0,
          statusText: "Blocked",
          durationMs: Date.now() - startTime,
          size: 0,
          passed: false,
          error: `Redirect blocked: ${hopCheck.reason}`,
        };
      }
      const convertToGet = [301, 302, 303].includes(response.status);
      response = await fetch(currentUrl, {
        method: convertToGet ? "GET" : "POST",
        headers: convertToGet ? { Accept: "application/json" } : reqHeaders,
        body: convertToGet ? undefined : body,
        signal: controller.signal,
        redirect: "manual",
      });
      hops++;
    }

    const durationMs = Date.now() - startTime;
    const { body: text, size, truncated } = await readBodyWithCap(response, maxSize);
    const passed = response.status < 400;

    if (truncated) {
      return {
        name: "GraphQL",
        method: "GRAPHQL" as HttpMethod,
        url,
        status: 0,
        statusText: "Blocked",
        durationMs,
        size,
        passed: false,
        error: `Response exceeds maximum allowed size of ${maxSize} bytes`,
      };
    }

    return {
      name: query.split(/\s+/).slice(0, 3).join(" ") || "GraphQL",
      method: "GRAPHQL" as HttpMethod,
      url,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      size,
      passed,
      body: text,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return {
      name: "GraphQL",
      method: "GRAPHQL" as HttpMethod,
      url,
      status: 0,
      statusText: isTimeout ? "Timeout" : "Error",
      durationMs,
      size: 0,
      passed: false,
      error: isTimeout ? `Request timed out after ${options.timeoutMs}ms` : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export function validateRequest(request: Partial<RequestItem>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!request.name || !request.name.trim()) {
    issues.push({ field: "name", severity: "error", message: "Request name is required" });
  }

  if (!request.url || !request.url.trim()) {
    issues.push({ field: "url", severity: "error", message: "Request URL is required" });
  } else {
    try {
      new URL(request.url);
    } catch {
      issues.push({ field: "url", severity: "error", message: `Invalid URL: ${request.url}` });
    }
  }

  if (request.method && !VALID_METHODS.includes(request.method)) {
    issues.push({
      field: "method",
      severity: "error",
      message: `Invalid HTTP method: ${request.method}`,
    });
  }

  if (request.body && request.bodyType === "json") {
    try {
      JSON.parse(request.body);
    } catch {
      issues.push({
        field: "body",
        severity: "warning",
        message: "Body is marked as JSON but is not valid JSON",
      });
    }
  }

  if (request.authType && request.authType !== "none" && !request.authToken) {
    issues.push({
      field: "authToken",
      severity: "warning",
      message: `Auth type is ${request.authType} but no token provided`,
    });
  }

  return issues;
}
