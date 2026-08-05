/**
 * Postman Collection (v2.0/v2.1) → recli ExportBundle importer.
 *
 * Strategy: keep Postman test/prerequest scripts as-is and run them through the
 * native pm.* sandbox API (pm.test, pm.expect, pm.response.to.have, ...) rather
 * than trying to statically translate arbitrary JS into structured assertions —
 * the sandbox executes the real thing. Folders become collections; collection
 * variables become always-on bundle variables; collection-level auth/events are
 * inherited by requests that don't override them.
 */

import fs from "node:fs";
import type {
  ExportBundle,
  RequestItem,
  Collection,
  Environment,
  EnvironmentVariable,
  AuthType,
} from "./types.js";

interface PmAuth {
  type?: string;
  bearer?: Array<{ key?: string; value?: string }>;
  basic?: Array<{ key?: string; value?: string }>;
  apikey?: Array<{ key?: string; value?: string; in?: string }>;
  oauth2?: Array<{ key?: string; value?: string }>;
}

interface PmEvent {
  listen?: string;
  script?: { exec?: string[] };
}

interface PmUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: Array<{ key?: string; value?: string; disabled?: boolean }>;
}

interface PmRequest {
  method?: string;
  url?: string | PmUrl;
  header?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  body?: {
    mode?: string;
    raw?: string;
    urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
    formdata?: Array<{
      key?: string;
      value?: string;
      type?: string;
      src?: string;
      disabled?: boolean;
    }>;
    graphql?: { query?: string; variables?: string };
  };
  auth?: PmAuth;
  description?: string | { content?: string };
}

interface PmItem {
  name?: string;
  request?: PmRequest;
  auth?: PmAuth;
  event?: PmEvent[];
  item?: PmItem[];
}

interface PmCollection {
  info?: { name?: string };
  item?: PmItem[];
  auth?: PmAuth;
  event?: PmEvent[];
  variable?: Array<{ key?: string; value?: string; disabled?: boolean }>;
}

const SUPPORTED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
  "GRAPHQL",
];

export function parsePostmanCollection(content: string): ExportBundle {
  let raw: PmCollection;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid Postman collection JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!raw || typeof raw !== "object" || !Array.isArray(raw.item)) {
    throw new Error('Not a Postman collection: missing top-level "item" array');
  }
  if (!raw.info?.name) {
    throw new Error('Not a Postman collection: missing "info.name"');
  }

  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
  };

  const bundleVars = toVariables(raw.variable);
  const collections: Collection[] = [];

  const main = buildCollection(raw.info.name, raw.item ?? [], raw.auth, raw.event, warn);
  collections.push(...main);

  const bundle: ExportBundle = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections,
  };
  if (bundleVars.length) bundle.variables = bundleVars;
  if (warnings.length)
    (bundle as ExportBundle & { importWarnings?: string[] }).importWarnings = warnings;

  return bundle;
}

/** Parse a collection tree into a list of flat recli collections. */
function buildCollection(
  name: string,
  items: PmItem[],
  inheritedAuth: PmAuth | undefined,
  inheritedEvents: PmEvent[] | undefined,
  warn: (msg: string) => void,
): Collection[] {
  const requests: RequestItem[] = [];
  const children: Collection[] = [];

  for (const item of items) {
    if (item.request) {
      const req = convertRequest(item, inheritedAuth, inheritedEvents, warn);
      if (req) requests.push(req);
    } else if (Array.isArray(item.item)) {
      // Folder — nested collections so TUI/run keep folder grouping. Names are
      // prefixed with their parent chain to stay unique when nesting.
      const folderName = item.name || "Untitled folder";
      const childName = `${name} / ${folderName}`;
      const nested = buildCollection(
        childName,
        item.item,
        item.auth ?? inheritedAuth,
        item.event ?? inheritedEvents,
        warn,
      );
      // A folder with no requests of its own still becomes a (possibly empty)
      // collection; drop empty ones to keep `run`/`ui` output clean.
      const [first, ...rest] = nested;
      if (first && first.requests.length > 0) children.push(first);
      children.push(...rest);
    }
  }

  if (requests.length === 0 && children.length === 0) return [];
  return [{ name, requests }, ...children];
}

function convertRequest(
  item: PmItem,
  inheritedAuth: PmAuth | undefined,
  inheritedEvents: PmEvent[] | undefined,
  warn: (msg: string) => void,
): RequestItem | null {
  const r = item.request!;
  const baseMethod = (r.method || "GET").toUpperCase();
  if (!SUPPORTED_METHODS.includes(baseMethod)) {
    warn(`Request "${item.name ?? "?"}": unsupported method ${baseMethod}, skipped`);
    return null;
  }

  const url = parseUrl(r.url, warn, item.name);
  const headers = parseHeaders(r.header);
  const body = parseBody(r, headers, warn, item.name);
  const auth = parseAuth(r.auth ?? inheritedAuth, headers, warn, item.name);

  // Postman runs collection-level events first, then item-level ones — keep both.
  const scripts = parseScripts([...(inheritedEvents ?? []), ...(item.event ?? [])]);

  const queryParams = parseQueryParams(r.url);
  const description =
    typeof r.description === "string"
      ? r.description
      : typeof r.description === "object" && r.description?.content
        ? r.description.content
        : undefined;

  // Postman GraphQL requests are POST with body.mode="graphql"; recli models
  // them with the GRAPHQL method + graphql config.
  const method = body.graphql ? "GRAPHQL" : baseMethod;

  const req: RequestItem = {
    name: item.name || `${method} ${url}`,
    method: method as RequestItem["method"],
    url,
    headers: Object.keys(headers).length ? headers : undefined,
    queryParams: queryParams.length ? queryParams : undefined,
    description,
  };
  if (body) {
    req.body = body.body;
    req.bodyType = body.bodyType;
  }
  if (auth.authType && auth.authToken) {
    req.authType = auth.authType;
    req.authToken = auth.authToken;
  }
  if (scripts.pre) req.scripts = { ...req.scripts, pre: scripts.pre };
  if (scripts.post) req.scripts = { ...req.scripts, post: scripts.post };
  if (body.graphql) req.graphql = body.graphql;

  return req;
}

function parseUrl(
  url: string | PmUrl | undefined,
  warn: (msg: string) => void,
  name?: string,
): string {
  if (typeof url === "string") return url;
  if (!url) return "";
  if (url.raw) return url.raw;
  if (url.host && url.host.length) {
    const host = url.host.join(".");
    const path = (url.path ?? []).map((seg) => `/${seg}`).join("");
    const protocol = url.protocol || "https";
    return `${protocol}://${host}${path || "/"}`;
  }
  warn(`Request "${name ?? "?"}": URL could not be resolved, using empty URL`);
  return "";
}

function parseQueryParams(
  url: string | PmUrl | undefined,
): Array<{ key: string; value: string; enabled?: boolean }> {
  if (!url || typeof url === "string" || !Array.isArray(url.query)) return [];
  return url.query
    .filter((q) => q && q.key !== undefined)
    .map((q) => ({ key: q.key!, value: q.value ?? "", enabled: !q.disabled }));
}

function parseHeaders(
  header: Array<{ key?: string; value?: string; disabled?: boolean }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of header ?? []) {
    if (!h.key || h.disabled) continue;
    out[h.key] = h.value ?? "";
  }
  return out;
}

interface ParsedBody {
  body?: string;
  bodyType?: "json" | "raw" | "x-www-form" | "form-data" | "graphql";
  graphql?: { query: string; variables?: string };
}

function parseBody(
  r: PmRequest,
  headers: Record<string, string>,
  warn: (msg: string) => void,
  name?: string,
): ParsedBody {
  const b = r.body;
  if (!b || !b.mode || b.mode === "none") return {};

  switch (b.mode) {
    case "raw":
      if (b.raw === undefined) return {};
      return { body: b.raw, bodyType: isJsonContent(headers) ? "json" : "raw" };
    case "urlencoded": {
      const pairs = (b.urlencoded ?? [])
        .filter((p) => !p.disabled && p.key !== undefined)
        .map(
          (p) =>
            `${encodeURIComponent(p.key!)}${p.value !== undefined ? `=${encodeURIComponent(p.value)}` : ""}`,
        );
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      return { body: pairs.join("&"), bodyType: "x-www-form" };
    }
    case "formdata": {
      const parts: string[] = [];
      for (const f of b.formdata ?? []) {
        if (f.disabled || f.key === undefined) continue;
        if (f.type === "file" || (f.type === undefined && f.src)) {
          warn(
            `Request "${name ?? "?"}": file upload in form-data is not supported, entry "${f.key}" skipped`,
          );
          continue;
        }
        parts.push(
          `${encodeURIComponent(f.key)}${f.value !== undefined ? `=${encodeURIComponent(f.value)}` : ""}`,
        );
      }
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      // ponytail: Postman form-data is real multipart; the runner has no multipart
      // encoder, so text entries become urlencoded. Files are skipped with a warning.
      return { body: parts.join("&"), bodyType: "x-www-form" };
    }
    case "graphql":
      return {
        bodyType: "graphql",
        graphql: {
          query: b.graphql?.query ?? "",
          variables: b.graphql?.variables ?? undefined,
        },
      };
    case "file":
      warn(`Request "${name ?? "?"}": file body is not supported, sending without a body`);
      return {};
    default:
      warn(`Request "${name ?? "?"}": unsupported body mode "${b.mode}", sending without a body`);
      return {};
  }
}

function isJsonContent(headers: Record<string, string>): boolean {
  const ct =
    Object.entries(headers)
      .find(([k]) => k.toLowerCase() === "content-type")?.[1]
      ?.toLowerCase() ?? "";
  return ct.includes("json");
}

function parseAuth(
  auth: PmAuth | undefined,
  headers: Record<string, string>,
  warn: (msg: string) => void,
  name?: string,
): { authType?: AuthType; authToken?: string } {
  if (!auth?.type || auth.type === "noauth" || auth.type === "none") return {};

  switch (auth.type) {
    case "bearer": {
      const token = auth.bearer?.find((x) => x.key === "token")?.value ?? auth.bearer?.[0]?.value;
      return token ? { authType: "bearer", authToken: token } : {};
    }
    case "basic": {
      const user =
        auth.basic?.find((x) => x.key === "username")?.value ?? auth.basic?.[0]?.value ?? "";
      const pass = auth.basic?.find((x) => x.key === "password")?.value ?? "";
      return { authType: "basic", authToken: Buffer.from(`${user}:${pass}`).toString("base64") };
    }
    case "apikey": {
      const entry = auth.apikey?.[0];
      if (entry?.in === "query") {
        warn(
          `Request "${name ?? "?"}": api-key in query is not wired (queryParams only captures url.query)`,
        );
      } else if (entry?.key) {
        headers[entry.key] = entry.value ?? "";
      }
      return {};
    }
    case "oauth2": {
      const token =
        auth.oauth2?.find((x) => x.key === "accessToken")?.value ?? auth.oauth2?.[0]?.value;
      return token ? { authType: "oauth2", authToken: token } : {};
    }
    default:
      warn(`Request "${name ?? "?"}": auth type "${auth.type}" is not supported`);
      return {};
  }
}

function parseScripts(events: PmEvent[] | undefined): { pre?: string; post?: string } {
  const scripts: { pre?: string; post?: string } = {};
  for (const ev of events ?? []) {
    const lines = ev.script?.exec;
    if (!lines) continue; // script.src (external file refs) can't be imported
    const joined = lines.join("\n").trim();
    if (!joined) continue;
    if (ev.listen === "prerequest")
      scripts.pre = scripts.pre ? `${scripts.pre}\n${joined}` : joined;
    else if (ev.listen === "test")
      scripts.post = scripts.post ? `${scripts.post}\n${joined}` : joined;
  }
  return scripts;
}

function toVariables(vars: PmCollection["variable"]): EnvironmentVariable[] {
  return (vars ?? [])
    .filter((v) => v.key !== undefined && v.key !== "")
    .map((v) => ({ key: v.key!, value: v.value ?? "", enabled: !v.disabled }));
}

/**
 * Parse a Postman environment file (`.postman_environment.json`) into a recli
 * Environment. Postman ships env files alongside collections — importing them
 * is what makes `{{client_id}}` etc. actually resolve at run time.
 */
export function parsePostmanEnvironment(content: string): Environment {
  let raw: { name?: string; values?: Array<{ key?: string; value?: string; enabled?: boolean }> };
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid Postman environment JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return {
    name: raw.name || "Postman environment",
    variables: (raw.values ?? [])
      .filter((v) => v.key !== undefined && v.key !== "")
      .map((v) => ({ key: v.key!, value: v.value ?? "", enabled: v.enabled ?? true })),
  };
}

/** Read + parse a Postman collection file. */
export function importPostmanCollection(filePath: string): ExportBundle {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`Cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parsePostmanCollection(content);
}
