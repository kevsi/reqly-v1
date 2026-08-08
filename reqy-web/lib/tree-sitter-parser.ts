import { readFileSync, existsSync } from "fs";
import { join } from "path";
// Lazy-loaded: web-tree-sitter pulls ~2 MB of WASM at runtime. Importing the
// value (not just the type) at module load would force every consumer of
// this file to pay that cost, even if they never parse anything (e.g. the
// main `request-panel` page). Keep type-only imports up here and load the
// real bindings on first use inside `initTreeSitter()`.
import type { Parser, Language, Tree } from "web-tree-sitter";

export interface ParsedRoute {
  method: string;
  path: string;
  name?: string;
  controller?: string | null;
  authRequired?: boolean;
  framework?: string;
  line?: number;
}

type GrammarId =
  | "python"
  | "java"
  | "php"
  | "ruby"
  | "go"
  | "rust"
  | "c-sharp"
  | "typescript"
  | "tsx"
  | "javascript"
  | "kotlin"
  | "swift"
  | "elixir"
  | "haskell";

const GRAMMAR_CONFIG: Record<string, { package: string; wasm: string }> = {
  python: { package: "tree-sitter-python", wasm: "tree-sitter-python.wasm" },
  java: { package: "tree-sitter-java", wasm: "tree-sitter-java.wasm" },
  php: { package: "tree-sitter-php", wasm: "tree-sitter-php.wasm" },
  ruby: { package: "tree-sitter-ruby", wasm: "tree-sitter-ruby.wasm" },
  go: { package: "tree-sitter-go", wasm: "tree-sitter-go.wasm" },
  rust: { package: "tree-sitter-rust", wasm: "tree-sitter-rust.wasm" },
  "c-sharp": { package: "tree-sitter-c-sharp", wasm: "tree-sitter-c_sharp.wasm" },
  typescript: { package: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  tsx: { package: "tree-sitter-typescript", wasm: "tree-sitter-tsx.wasm" },
  javascript: { package: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
};

const EXT_TO_GRAMMAR: Record<string, GrammarId> = {
  py: "python",
  java: "java",
  php: "php",
  rb: "ruby",
  go: "go",
  rs: "rust",
  cs: "c-sharp",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
};

const FRAMEWORK_TO_GRAMMAR: Record<string, GrammarId> = {
  fastapi: "python",
  flask: "python",
  django: "python",
  tornado: "python",
  sanic: "python",
  starlette: "python",
  litestar: "python",
  aiohttp: "python",
  falcon: "python",
  spring: "java",
  micronaut: "java",
  quarkus: "java",
  laravel: "php",
  rails: "ruby",
  sinatra: "ruby",
  go: "go",
  gin: "go",
  echo: "go",
  fiber: "go",
  chi: "go",
  actix: "rust",
  axum: "rust",
  rocket: "rust",
  aspnet: "c-sharp",
  nestjs: "typescript",
  express: "typescript",
  fastify: "typescript",
  koa: "typescript",
  hapi: "typescript",
  nextjs: "typescript",
};

let initPromise: Promise<void> | null = null;
const loadedLangs = new Map<string, Language>();
const parserCache = new Map<string, Parser>();

// Cached dynamic import — the real bindings are loaded once on first use.
let treeSitterModule: typeof import("web-tree-sitter") | null = null;
async function getTreeSitter(): Promise<typeof import("web-tree-sitter")> {
  if (!treeSitterModule) {
    treeSitterModule = await import("web-tree-sitter");
  }
  return treeSitterModule;
}

const MODULE_DIR = __dirname;

function findWasmPath(grammar: string, wasmFile: string): string | null {
  const candidates: string[] = [];

  // 1. Explicit env var override
  const envDir = typeof process !== "undefined" ? process.env.TREE_SITTER_WASM_DIR : undefined;
  if (envDir) {
    candidates.push(join(envDir, grammar, wasmFile));
  }

  // 2. Module-relative (works regardless of cwd)
  candidates.push(join(MODULE_DIR, "..", "node_modules", grammar, wasmFile));
  candidates.push(join(MODULE_DIR, "..", "..", "node_modules", grammar, wasmFile));

  // 3. Resources path (Tauri / Electron)
  const tauriProcess =
    typeof process !== "undefined"
      ? (process as NodeJS.Process & { resourcesPath?: string })
      : undefined;
  const resourcesPath = tauriProcess
    ? (tauriProcess.resourcesPath ?? tauriProcess.env.RESOURCES_PATH)
    : undefined;
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "node_modules", grammar, wasmFile));
  }

  // 4. cwd-relative (current fallback)
  const cwd = (typeof process !== "undefined" && process.cwd()) || ".";
  candidates.push(join(cwd, "node_modules", grammar, wasmFile));
  candidates.push(join(cwd, "..", "node_modules", grammar, wasmFile));
  candidates.push(join(cwd, "..", "..", "node_modules", grammar, wasmFile));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function initTreeSitter(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const ts = await getTreeSitter();
    const wasmPath = findWasmPath("web-tree-sitter", "web-tree-sitter.wasm");
    if (wasmPath) {
      await ts.Parser.init(readFileSync(wasmPath).buffer as ArrayBuffer);
    } else {
      await ts.Parser.init();
    }
  })();
  return initPromise;
}

export async function loadLanguage(lang: GrammarId): Promise<Language | null> {
  if (loadedLangs.has(lang)) return loadedLangs.get(lang)!;
  await initTreeSitter();
  const cfg = GRAMMAR_CONFIG[lang];
  if (!cfg) return null;

  const wasmPath = findWasmPath(cfg.package, cfg.wasm);
  if (!wasmPath) return null;

  try {
    const ts = await getTreeSitter();
    const wasmBytes = readFileSync(wasmPath);
    const language = await ts.Language.load(wasmBytes);
    loadedLangs.set(lang, language);
    return language;
  } catch {
    return null;
  }
}

function getParser(lang: GrammarId): Parser | null {
  let p = parserCache.get(lang);
  if (p) return p;
  const language = loadedLangs.get(lang);
  if (!language) return null;
  // Tree is bundled in the cached module — safe to use the value form here.
  // We need a Parser instance synchronously, so use the cached module directly.
  const ts = treeSitterModule;
  if (!ts) return null;
  p = new ts.Parser();
  p.setLanguage(language);
  parserCache.set(lang, p);
  return p;
}

export function grammarForFramework(framework: string): GrammarId | null {
  return FRAMEWORK_TO_GRAMMAR[framework] || null;
}

export function detectLanguageFromFile(filePath: string): GrammarId | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? EXT_TO_GRAMMAR[ext] || null : null;
}

// ── Query definitions per framework ─────────────────────────────────────

interface RouteQuery {
  language: GrammarId;
  query: string;
  frameworks: string[];
  extract: (c: Captures) => ParsedRoute | null;
}

interface Captures {
  obj?: string[];
  method?: string[];
  path?: string[];
  name?: string[];
  class?: string[];
  verb?: string[];
  receiver?: string[];
  annot?: string[];
  full?: string[];
  [key: string]: string[] | undefined;
}

const ROUTE_QUERIES: RouteQuery[] = [
  // ── Python (FastAPI, Flask, etc.) ──────────────────────────────────
  {
    language: "python",
    frameworks: ["fastapi", "flask", "sanic", "aiohttp", "tornado", "python"],
    query: `(decorated_definition
      (decorator
        (call
          function: (attribute object: (identifier)@obj attribute: (identifier)@method)
          arguments: (argument_list .
            (string (string_content)@path) .
            (keyword_argument)? .
          )))
      (function_definition name: (identifier)@name)) @full`,
    extract: (c) => {
      const method = c.method?.[0];
      const path = c.path?.[0];
      const name = c.name?.[0];
      const obj = c.obj?.[0];
      if (!method || !path) return null;
      const m = pythonMethodToHttp(method);
      if (!m) return null;
      return { method: m, path, name, controller: obj, framework: "python" };
    },
  },
  // ── PHP (Laravel) ──────────────────────────────────────────────────
  {
    language: "php",
    frameworks: ["laravel"],
    query: `(scoped_call_expression
      scope: (name)@class
      name: (name)@method
      arguments: (arguments (argument (string (string_content)@path))?)) @full`,
    extract: (c) => {
      const cls = c.class?.[0];
      const verb = c.method?.[0];
      if (cls !== "Route" || !verb) return null;
      const m = laravelMethodToHttp(verb);
      if (!m) return null;
      const path = (c.path || []).find((p) => p.startsWith("/")) || c.path?.[0] || "";
      return { method: m, path: path, framework: "laravel", name: "" };
    },
  },
  // ── Java (Spring) — with path args ──────────────────────────────
  {
    language: "java",
    frameworks: ["spring", "micronaut", "quarkus"],
    query: `(annotation
      name: (identifier)@annot
      arguments: (annotation_argument_list (string_literal)@path)) @full`,
    extract: (c) => {
      const annot = c.annot?.[0] ?? "";
      if (!annot) return null;
      const m = annotationToMethod(annot);
      if (!m) return null;
      if (annot === "RequestMapping") return null;
      const rawPath = c.path?.[0] ?? "";
      const path = rawPath.replace(/^['"]|['"]$/g, "");
      return { method: m, path, framework: "spring", name: "" };
    },
  },
  // ── Java (Spring) — marker annotation, no path arg ──────────────
  {
    language: "java",
    frameworks: ["spring", "micronaut", "quarkus"],
    query: `(marker_annotation name: (identifier)@annot) @full`,
    extract: (c) => {
      const annot = c.annot?.[0] ?? "";
      if (!annot) return null;
      const m = annotationToMethod(annot);
      if (!m) return null;
      if (annot === "RequestMapping") return null;
      return { method: m, path: "", framework: "spring", name: "" };
    },
  },
  // ── Ruby (Rails, Sinatra) ──────────────────────────────────────────
  {
    language: "ruby",
    frameworks: ["rails", "sinatra"],
    query: `(call method: (identifier)@verb arguments: (argument_list (string (string_content)@path))) @full`,
    extract: (c) => {
      const verb = c.verb?.[0];
      const path = c.path?.[0];
      if (!verb || !path) return null;
      const m = rubyMethodToHttp(verb);
      if (!m) return null;
      return { method: m, path, framework: "rails", name: "" };
    },
  },
  {
    language: "ruby",
    frameworks: ["rails"],
    query: `(call method: (identifier)@verb arguments: (argument_list (simple_symbol)@path)) @full`,
    extract: (c) => {
      const verb = c.verb?.[0];
      let path = c.path?.[0] ?? "";
      if (!verb || !path || !["resources", "resource"].includes(verb)) return null;
      path = path.replace(/^:/, "/");
      return { method: "GET", path, framework: "rails", name: "" };
    },
  },
  // ── Go (Gin, Echo, Fiber) ──────────────────────────────────────────
  {
    language: "go",
    frameworks: ["go", "gin", "echo", "fiber", "chi"],
    query: `(call_expression
      function: (selector_expression
        operand: (_)@receiver
        field: (field_identifier)@method)
      arguments: (argument_list
        (interpreted_string_literal (interpreted_string_literal_content)@path)@first)) @full`,
    extract: (c) => {
      const method = c.method?.[0];
      const path = c.path?.[0];
      if (!method || !path) return null;
      const m = goMethodToHttp(method);
      if (!m) return null;
      return { method: m, path, framework: "go", name: "" };
    },
  },
  // ── Rust (Actix, Axum, Rocket) ─────────────────────────────────────
  {
    language: "rust",
    frameworks: ["actix", "axum", "rocket", "rust"],
    query: `(attribute_item
      (attribute
        (identifier)@method
        arguments: (token_tree (string_literal (string_content)@path))))
      @full`,
    extract: (c) => {
      const method = c.method?.[0];
      const path = c.path?.[0];
      if (!method) return null;
      const m = rustMethodToHttp(method);
      if (!m) return null;
      return { method: m, path: path || "/", framework: "rust", name: "" };
    },
  },
  // ── C# (ASP.NET) ───────────────────────────────────────────────────
  {
    language: "c-sharp",
    frameworks: ["aspnet"],
    query: `(attribute name: (identifier)@method (attribute_argument_list (attribute_argument (string_literal (string_literal_content)@path)))?) @full`,
    extract: (c) => {
      const method = c.method?.[0] ?? "";
      const path = c.path?.[0] ?? "";
      const m = aspNetMethodToHttp(method);
      if (!m) return null;
      return { method: m, path, framework: "aspnet", name: "" };
    },
  },
];

// ── HTTP method mapping ────────────────────────────────────────────────

const HTTP_METHODS_UPPER = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
const HTTP_METHODS_LOWER = new Set(["get", "post", "put", "delete", "patch", "head", "options"]);
const HTTP_METHODS_LOWER_FULL = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

function pythonMethodToHttp(m: string): string | null {
  const u = m.toUpperCase();
  if (HTTP_METHODS_UPPER.has(u)) return u;
  if (m === "route") return "GET";
  return null;
}

function laravelMethodToHttp(m: string): string | null {
  const l = m.toLowerCase();
  if (HTTP_METHODS_LOWER_FULL.has(l)) return l.toUpperCase();
  if (l === "any" || l === "match" || l === "resource") return "GET";
  return null;
}

function rubyMethodToHttp(m: string): string | null {
  const l = m.toLowerCase();
  if (l === "get" || l === "post" || l === "put" || l === "patch" || l === "delete")
    return l.toUpperCase();
  if (["resources", "resource", "match", "root"].includes(l)) return "GET";
  return null;
}

function goMethodToHttp(m: string): string | null {
  const u = m.toUpperCase();
  if (HTTP_METHODS_UPPER.has(u)) return u;
  if (m === "Handle" || m === "HandleFunc" || m === "Any") return "GET";
  return null;
}

function rustMethodToHttp(m: string): string | null {
  const l = m.toLowerCase();
  const u = m.toUpperCase();
  if (HTTP_METHODS_LOWER.has(l)) return u;
  if (l === "route") return "GET";
  return null;
}

function aspNetMethodToHttp(m: string): string | null {
  const clean = m.replace(/Attribute$/i, "");
  const l = clean.toLowerCase();
  if (l === "httpget") return "GET";
  if (l === "httppost") return "POST";
  if (l === "httpput") return "PUT";
  if (l === "httpdelete") return "DELETE";
  if (l === "httppatch") return "PATCH";
  if (l === "httphead") return "HEAD";
  if (l === "httpoptions") return "OPTIONS";
  if (HTTP_METHODS_LOWER.has(l)) return l.toUpperCase();
  return null;
}

function annotationToMethod(annot: string): string | null {
  const u = annot.toUpperCase();
  if (HTTP_METHODS_UPPER.has(u)) return u;
  if (annot === "RequestMapping" || annot === "requestmapping") return "GET";
  const mapping = u.replace(/MAPPING$/, "");
  if (HTTP_METHODS_UPPER.has(mapping)) return mapping;
  return null;
}

function normalizePath(p: string): string {
  let n = p.trim();
  if (!n.startsWith("/")) n = "/" + n;
  n = n
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/\{([a-zA-Z_]\w*)\}/g, ":$1")
    .replace(/<([a-zA-Z_]\w*)(?::[^>]+)?>/g, ":$1")
    .replace(/:([a-zA-Z_]\w*)/g, ":$1")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return n === "" ? "/" : n;
}

// ── Main detection API ─────────────────────────────────────────────────

export async function detectRoutesWithTreeSitter(
  content: string,
  filePath: string,
  framework: string,
): Promise<ParsedRoute[]> {
  const grammarId = grammarForFramework(framework);
  if (!grammarId) return [];

  await initTreeSitter();
  // `initTreeSitter` guarantees `treeSitterModule` is populated. Use the
  // local `ts` reference for `Query` so we don't have to keep the bare
  // type-only `Query` import in sync.
  const ts = treeSitterModule;
  if (!ts) return [];

  const language = loadedLangs.get(grammarId) || (await loadLanguage(grammarId));
  if (!language) return [];

  const parser = getParser(grammarId);
  if (!parser) return [];

  let tree: Tree | null;
  try {
    tree = parser.parse(content);
  } catch {
    return [];
  }
  if (!tree?.rootNode) return [];

  const relevantQueries = ROUTE_QUERIES.filter(
    (q) => q.frameworks.includes(framework) && q.language === grammarId,
  );
  if (relevantQueries.length === 0) return [];

  const seen = new Set<string>();
  const results: ParsedRoute[] = [];

  for (const rq of relevantQueries) {
    try {
      const query = new ts.Query(language, rq.query);
      const matches = query.matches(tree.rootNode);

      for (const match of matches) {
        const raw: Record<string, string[]> = {};
        for (const { name, node } of match.captures) {
          if (!raw[name]) raw[name] = [];
          raw[name].push(node.text);
        }

        const single: Captures = {};
        for (const key of Object.keys(raw)) {
          single[key] = [raw[key][0]];
        }

        const route = rq.extract(single);
        if (!route) continue;

        const rawPath = route.path;
        if (rawPath === undefined || rawPath === null) continue;
        if (
          rawPath.includes("@") ||
          rawPath.includes("::") ||
          rawPath.startsWith("Route") ||
          rawPath.includes("Controller@")
        )
          continue;

        const cleanPath = rawPath.replace(/^['"]|['"]$/g, "");
        const normalizedPath = normalizePath(cleanPath);

        const key = `${route.method}|${normalizedPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          route.path = normalizedPath;
          results.push(route);
        }
      }
    } catch {}
  }

  // Post-process: prepend class-level @RequestMapping prefix for Java frameworks
  if (["spring", "micronaut", "quarkus"].includes(framework) && results.length > 0) {
    try {
      const classQuery = new ts.Query(
        language,
        `(annotation name: (identifier)@annot (annotation_argument_list (string_literal)@path)) @full`,
      );
      const classMatches = classQuery.matches(tree.rootNode);
      let classPrefix = "";
      for (const m of classMatches) {
        const annot = (m.captures.find((c) => c.name === "annot")?.node?.text ?? "").replace(
          /Mapping$/i,
          "",
        );
        if (annot.toUpperCase() === "REQUEST" || annot.toUpperCase() === "PATH") {
          classPrefix = m.captures.find((c) => c.name === "path")?.node?.text ?? "";
          if (classPrefix) {
            classPrefix = classPrefix.replace(/^['"]|['"]$/g, "");
            break;
          }
        }
      }
      if (classPrefix) {
        for (const route of results) {
          route.path = normalizePath(`${classPrefix}/${route.path}`);
        }
      }
    } catch {}
  }

  return results;
}

export async function loadAllGrammars(): Promise<string[]> {
  const ids: GrammarId[] = [
    "python",
    "java",
    "php",
    "ruby",
    "go",
    "rust",
    "c-sharp",
    "javascript",
    "typescript",
  ];
  const loaded: string[] = [];
  for (const id of ids) {
    const l = await loadLanguage(id);
    if (l) loaded.push(id);
  }
  return loaded;
}
