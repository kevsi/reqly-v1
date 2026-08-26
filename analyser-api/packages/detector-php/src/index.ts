import * as path from "node:path";
import type {
  ApiRoute,
  AstGrepMatch,
  Detector,
  HttpMethod,
  RegexRule,
} from "@analyser/core";

const HTTP_METHODS = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD",
]);

function isHttpMethod(m: string | undefined): boolean {
  return HTTP_METHODS.has((m ?? "").toUpperCase());
}

// Matches Laravel/Slim-style route definitions:
//   Route::get('/path', ...)
//   $app->post("/path", ...)
//   $router->put('/path', ...)
const ROUTE_CALL_RE = /(?:Route|\\\$app|\\\$router|app|router)\s*(?:->|::)\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

// Matches method-based routing in custom PHP frameworks:
//   if ($_SERVER['REQUEST_METHOD'] === 'POST') { ... }
//   if ($_SERVER['REQUEST_METHOD'] == "GET") { ... }
const REQUEST_METHOD_RE = /_SERVER\s*\[\s*['"]REQUEST_METHOD['"]\s*\]\s*===\s*['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]/gi;

const RULES: RegexRule[] = [
  {
    id: "php-route-call",
    pattern: ROUTE_CALL_RE,
    capture: { METHOD: 1, PATH: 2 },
  },
  {
    id: "php-request-method",
    pattern: REQUEST_METHOD_RE,
    capture: { METHOD: 1 },
  },
];

export const detectorPhp: Detector = {
  name: "detector-php",
  language: "php",
  frameworks: ["custom"],
  extensions: [".php"],
  ignoreDirs: ["vendor", "node_modules"],
  canHandle(manifestFiles: string[]) {
    return manifestFiles.some((f) => path.basename(f) === "composer.json");
  },
  rules: [],
  regexRules: RULES,
  assemble(matches: AstGrepMatch[], _rootPath?: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    const seen = new Set<string>();

    // From regex/ast-grep matches (framework routes).
    for (const m of matches) {
      const methodRaw = m.node.get("METHOD")?.toUpperCase() ?? "";
      if (!isHttpMethod(methodRaw)) continue;
      const p = m.node.get("PATH");
      if (!p) continue;
      const key = `${methodRaw} ${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({
        id: `php-${methodRaw.toLowerCase()}-${p.replace(/[^a-z0-9]/gi, "-")}`,
        method: methodRaw as HttpMethod,
        path: p,
        file: m.file,
        line: m.line,
        framework: "custom",
        language: "php",
        auth: { required: false, confidence: "low" },
        params: extractParams(p),
        raw: m.text,
      });
    }

    return routes;
  },
};

function extractParams(pathStr: string): string[] {
  const params: string[] = [];
  const re = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathStr)) !== null) {
    params.push(m[1]!);
  }
  return params;
}
