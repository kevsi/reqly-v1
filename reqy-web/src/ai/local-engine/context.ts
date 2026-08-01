/**
 * Context Builder — captures the active request + response (or error) and
 * produces a normalized RequestContext for the local rules engine.
 */
import type {
  AuthType,
  NetworkError,
  RequestContext,
  RequestPayload,
  ResponsePayload,
} from "@/src/ai/types";

function inferAuthType(headers: Record<string, string>): AuthType {
  const auth = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === "authorization"
  )?.[1];
  if (!auth) return "none";
  if (/^Bearer\s+/i.test(auth)) return "bearer";
  if (/^Basic\s+/i.test(auth)) return "basic";
  return "none";
}

export interface BuildContextOptions {
  response?: ResponsePayload;
  error?: NetworkError;
  /** Override timestamp (for deterministic tests). */
  now?: () => number;
}

export function buildRequestContext(
  request: RequestPayload,
  response?: ResponsePayload,
  error?: NetworkError
): RequestContext;

export function buildRequestContext(
  request: RequestPayload,
  optionsOrResponse?: BuildContextOptions | ResponsePayload,
  error?: NetworkError
): RequestContext {
  let resolvedResponse: ResponsePayload | undefined;
  let resolvedError: NetworkError | undefined;

  if (
    optionsOrResponse &&
    typeof optionsOrResponse === "object" &&
    "status" in optionsOrResponse
  ) {
    resolvedResponse = optionsOrResponse as ResponsePayload;
  } else if (optionsOrResponse && typeof optionsOrResponse === "object") {
    resolvedResponse = (optionsOrResponse as BuildContextOptions).response;
    resolvedError = (optionsOrResponse as BuildContextOptions).error ?? error;
  } else {
    // optionsOrResponse is undefined: legacy 3-arg form, e.g.
    // buildRequestContext(req, undefined, err)
    resolvedError = error;
  }

  const normalizedRequest: RequestPayload = {
    ...request,
    authType:
      request.authType && request.authType !== "none"
        ? request.authType
        : inferAuthType(request.headers),
  };

  return {
    request: normalizedRequest,
    response: resolvedResponse,
    error: resolvedError,
    timestamp: Date.now(),
  };
}
