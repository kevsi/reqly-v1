import type { HttpMethod, MatchRule, MockRoute, RequestContext } from "./types.js";

interface CompiledPath {
  segments: string[];
  hasSplat: boolean;
}

const pathCache = new Map<string, CompiledPath>();

function compilePath(pattern: string): CompiledPath {
  const cached = pathCache.get(pattern);
  if (cached) return cached;
  const segments = pattern.split("/").filter((s) => s.length > 0);
  const compiled: CompiledPath = {
    segments,
    hasSplat: segments.some((s) => s === "*splat" || s === "*" || s.startsWith("*")),
  };
  pathCache.set(pattern, compiled);
  return compiled;
}

/** Match a request path against a route pattern. Returns path params or null. */
export function matchPath(pattern: string, actualPath: string): Record<string, string> | null {
  const compiled = compilePath(pattern);
  const parts = actualPath.split("/").filter((s) => s.length > 0);

  if (!compiled.hasSplat && parts.length !== compiled.segments.length) return null;
  if (compiled.hasSplat && parts.length < compiled.segments.length - 1) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < compiled.segments.length; i++) {
    const seg = compiled.segments[i] as string;

    if (seg === "*splat" || seg === "*") {
      const rest = parts.slice(i);
      if (rest.length === 0) return null;
      params["splat"] = rest.join("/");
      return params;
    }
    if (seg.startsWith(":")) {
      params[seg.slice(1)] = decodeURIComponent(parts[i] ?? "");
      continue;
    }
    if (seg !== decodeURIComponent(parts[i] ?? "")) return null;
  }
  // Exact-length patterns must consume the whole path.
  if (!compiled.hasSplat && parts.length > compiled.segments.length) return null;
  return params;
}

/** Find the first matching route for a method + path. */
export function findRoute(
  routes: MockRoute[],
  method: string,
  actualPath: string,
): { route: MockRoute; params: Record<string, string> } | null {
  const upper = method.toUpperCase();
  for (const route of routes) {
    if (route.method.toUpperCase() !== upper) continue;
    const params = matchPath(route.path, actualPath);
    if (params) return { route, params };
  }
  return null;
}

type RuleContext = Pick<RequestContext, "query" | "headers" | "body" | "rawBody">;

/** Read a dot-path from a parsed JSON body ("user.address.city"). */
function readDotPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function valueToComparable(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function evaluateRule(rule: MatchRule, ctx: RuleContext): boolean {
  let actual: unknown;
  switch (rule.target) {
    case "query":
      actual = rule.name ? ctx.query[rule.name] : ctx.query;
      break;
    case "header":
      actual = rule.name
        ? (ctx.headers[rule.name.toLowerCase()] ?? ctx.headers[rule.name])
        : ctx.headers;
      break;
    case "body": {
      const parsed = ctx.body ?? safeParse(ctx.rawBody);
      actual = readDotPath(parsed, rule.name);
      break;
    }
  }

  switch (rule.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "missing":
      return actual === undefined || actual === null || actual === "";
    case "equals":
      return (
        valueToComparable(actual).toLowerCase() === valueToComparable(rule.value).toLowerCase()
      );
    case "contains": {
      if (Array.isArray(actual)) return actual.map(valueToComparable).includes(String(rule.value));
      return valueToComparable(actual).includes(String(rule.value));
    }
    case "regex": {
      try {
        return new RegExp(rule.value ?? "").test(valueToComparable(actual));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export function evaluateRules(rules: MatchRule[] | undefined, ctx: RuleContext): boolean {
  if (!rules || rules.length === 0) return false; // no rules → not auto-selected
  return rules.every((r) => evaluateRule(r, ctx));
}

/** Select a response: first whose rules all pass, else defaultId, else first. */
export function selectResponse(
  route: MockRoute,
  ctx: RuleContext,
): MockRoute["responses"][number] | null {
  if (route.responses.length === 0) return null;
  for (const response of route.responses) {
    if (evaluateRules(response.rules, ctx)) return response;
  }
  if (route.defaultResponseId) {
    const def = route.responses.find((r) => r.id === route.defaultResponseId);
    if (def) return def;
  }
  return route.responses[0] as MockRoute["responses"][number];
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
