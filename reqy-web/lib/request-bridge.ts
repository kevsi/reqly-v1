/**
 * Request Bridge — module-level SPA bridge for passing a pending collection
 * request from /collections to the editor at /.
 *
 * Unlike localStorage, a module-scoped variable survives client-side
 * navigation (router.push) in a Next.js SPA without race conditions,
 * serialization overhead, or the risk of stale entries.
 */

export interface PendingCollectionRequest {
  id?: string;
  name: string;
  method: string;
  url: string;
  endpoint: string;
  headers?: Record<string, string>;
  body?: string;
  bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
  authType?: "none" | "bearer" | "basic" | "api-key" | "oauth2";
  authToken?: string;
  queryParams?: Array<{ key: string; value: string }>;
  pathParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  assertions?: import("@/lib/types").RequestTestAssertion[];
  runnerAssertions?: import("@/lib/test-runner/types").Assertion[];
  preRequestScript?: string;
  postResponseScript?: string;
  datasetKey?: string;
  protocol?: "rest" | "graphql";
  graphql?: {
    query: string;
    variables: string;
    operationName?: string;
  };
  sendImmediately?: boolean;
  collectionId?: string;
  background?: boolean;
  requestIds?: string[];
}

// Module-scoped state survives client-side navigations in a Next.js SPA.
let _pending: PendingCollectionRequest | null = null;

/** Store a collection request for the editor to pick up after navigation. */
export function setPendingCollectionRequest(request: PendingCollectionRequest): void {
  _pending = request;
}

/** Read and clear (destructive). */
export function getAndClearPendingCollectionRequest(): PendingCollectionRequest | null {
  const r = _pending;
  _pending = null;
  return r;
}

/** Peek without clearing (non-destructive). */
export function peekPendingCollectionRequest(): PendingCollectionRequest | null {
  return _pending;
}

/** Clear without reading. */
export function clearPendingCollectionRequest(): void {
  _pending = null;
}
