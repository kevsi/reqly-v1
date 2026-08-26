import * as path from "node:path";
import { extractParams } from "@analyser/core";
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
//   Route::middleware('auth')->get('/path', ...)
//   $app->post("/path", ...)
//   $router->put('/path', ...)
const ROUTE_CALL_RE =
  /(?:Route|\$app|\$router|app|router)\s*(?:->|::)\s*(?:middleware\s*\([^)]*\)\s*(?:->|::)\s*)*(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

// Matches method-based routing in custom PHP frameworks:
//   if ($_SERVER['REQUEST_METHOD'] === 'POST') { ... }
//   if ($_SERVER['REQUEST_METHOD'] == "GET") { ... }
const REQUEST_METHOD_RE =
  /_SERVER\s*\[\s*['"]REQUEST_METHOD['"]\s*\]\s*={2,3}\s*['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]/gi;

// Matches Symfony attribute routing:
//   #[Route('/health', methods: ['GET'])]
//   #[Route(path: "/users", methods: ["POST"])]
//   #[Route('/users/{id}', methods: ['DELETE'])]
const SYMFONY_ROUTE_RE = /#\[Route\s*\([^)]*?['"`]([^'"`]+)['"`][^)]*\)/gi;

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
  {
    id: "php-symfony-attribute",
    pattern: SYMFONY_ROUTE_RE,
    capture: { PATH: 1 },
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
      let methodRaw = m.node.get("METHOD")?.toUpperCase() ?? "";
      let p: string | undefined = m.node.get("PATH");

      if (m.ruleId === "php-symfony-attribute") {
        const methodsMatch = m.text.match(/methods\s*[:=]\s*\[([^\]]*)\]/i);
        if (methodsMatch?.[1]) {
          const first = methodsMatch[1].match(/['"](\w+)['"]/);
          if (first?.[1]) methodRaw = first[1].toUpperCase();
          else methodRaw = "GET";
        } else {
          methodRaw = "GET";
        }
        if (!p) continue;
      } else if (m.ruleId === "php-request-method") {
        if (!p) {
          const resource = path.basename(path.dirname(m.file));
          // Skip generic dir names that are fixture scaffolding.
          if (!resource || resource === "." || resource === path.basename(_rootPath ?? "")) {
            p = "/";
          } else {
            p = `/${resource}`;
          }
        }
        if (!methodRaw) continue;
      }

      if (!isHttpMethod(methodRaw)) continue;
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


