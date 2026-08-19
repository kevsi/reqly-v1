import type { ApiRoute, HttpMethod } from "./types.ts";

export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export function isHttpMethod(m: string): m is HttpMethod {
  return HTTP_METHODS.has(m.toUpperCase());
}

export function extractParams(path: string): string[] {
  const params: string[] = [];
  for (const m of path.matchAll(/(?::|[{[])([A-Za-z_][\w]*)(?:[}\]])?/g)) {
    if (m[1]) params.push(m[1]);
  }
  return [...new Set(params)];
}

export function joinPaths(prefix: string, sub: string): string {
  const parts = [prefix, sub].map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p.length > 0);
  return "/" + parts.join("/");
}

export function dedupeRoutes(routes: ApiRoute[]): ApiRoute[] {
  const seen = new Set<string>();
  const out: ApiRoute[] = [];
  for (const r of routes) {
    const key = `${r.method} ${r.path} ${r.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.method.localeCompare(b.method) ||
      a.path.localeCompare(b.path),
  );
  return out;
}

export function stripQuotes(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, "");
}

export function makeId(
  prefix: string,
  method: string,
  path: string,
  file: string,
  line: number,
): string {
  return `${prefix}:${method}:${path}:${file}:${line}`;
}

export const AUTH_HINTS =
  /(auth|jwt|token|session|passport|isAuthenticated|authenticate|requireAuth|require_auth|verifyToken|verifyJwt|oauth|current_user|login_required|protect|guard)/i;

export interface RouteDiff {
  added: ApiRoute[];
  removed: ApiRoute[];
  changed: ApiRoute[];
}

const routeKey = (r: ApiRoute): string => `${r.method} ${r.path} ${r.file}`;

/** Compares two route lists by identity key (method+path+file), then by
 * auth/body/params for the changed set. */
export function diffRoutes(prev: ApiRoute[], current: ApiRoute[]): RouteDiff {
  const prevByKey = new Map(prev.map((r) => [routeKey(r), r]));
  const curByKey = new Map(current.map((r) => [routeKey(r), r]));
  const added = current.filter((r) => !prevByKey.has(routeKey(r)));
  const removed = prev.filter((r) => !curByKey.has(routeKey(r)));
  const changed = current.filter((r) => {
    const before = prevByKey.get(routeKey(r));
    if (!before) return false;
    const a = compactForDiff(before);
    const b = compactForDiff(r);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  return { added, removed, changed };
}

function compactForDiff(r: ApiRoute) {
  return {
    auth: r.auth.required,
    body: r.body,
    params: r.params,
    query: r.query,
  };
}
