import * as path from "node:path";
import { AUTH_HINTS, extractParams, isHttpMethod, makeId, stripQuotes } from "@analyser/core";
import type {
  ApiRoute,
  AstGrepMatch,
  AstGrepRule,
  Detector,
  HttpMethod,
  MatchedNode,
} from "@analyser/core";

const ACTIX_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

const RULES: AstGrepRule[] = [
  { id: "route", pattern: "$ROUTER.route($PATH, $HANDLER)" },
  { id: "actix-decorator", pattern: "#[$METHOD($PATH)]" },
  { id: "actix-route-attr", pattern: "#[$METHOD($PATH, $$$REST)]" },
];

function methodFromHandler(handler: string): HttpMethod | undefined {
  const m = handler.trim().match(/^(?:web::)?(\w+)/);
  if (!m) return undefined;
  const word = m[1]!.toLowerCase();
  if (word === "to" || word === "service" || word === "any") return "ALL";
  return isHttpMethod(word) ? (word.toUpperCase() as HttpMethod) : undefined;
}

function schemaFromHandler(handler: string): { schemaName?: string; contentType?: string } {
  for (const [re, ct] of [
    [/Json<([A-Za-z_]\w*)>/, "application/json"],
    [/Form<([A-Za-z_]\w*)>/, "application/x-www-form-urlencoded"],
    [/Bytes<([A-Za-z_]\w*)>/, "application/octet-stream"],
  ] as const) {
    const m = handler.match(re);
    if (m?.[1]) return { schemaName: m[1], contentType: ct };
  }
  return {};
}

/** Rust attributes are siblings of the function in the source_file/module.
 * Collects the attributes preceding/following the matched attribute up to the
 * next function_item. */
function attachFunction(
  attr: MatchedNode,
  text: string,
): { fnText: string; attrs: string[] } | null {
  let scope: MatchedNode | null = attr.parent();
  while (scope && scope.kind() !== "source_file" && scope.kind() !== "module") {
    scope = scope.parent();
  }
  if (!scope) return null;
  const sibs = scope.children();
  const idx = sibs.findIndex((s) => s.text() === text);
  if (idx < 0) return null;
  const attrs = [text];
  for (let i = idx - 1; i >= 0; i--) {
    if (sibs[i]!.kind() === "attribute_item") attrs.unshift(sibs[i]!.text());
    else break;
  }
  for (let i = idx + 1; i < sibs.length; i++) {
    const k = sibs[i]!;
    if (k.kind() === "attribute_item") attrs.push(k.text());
    else if (k.kind() === "function_item") return { fnText: k.text(), attrs };
    else break;
  }
  return null;
}

export const detectorRust: Detector = {
  name: "detector-rust",
  language: "rust",
  frameworks: ["axum", "actix-web"],
  extensions: [".rs"],
  ignoreDirs: ["target"],
  canHandle(manifestFiles) {
    return manifestFiles.some((f) => path.basename(f) === "Cargo.toml");
  },
  rules: RULES,
  assemble(matches: AstGrepMatch[], rootPath?: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    void rootPath;

    for (const m of matches) {
      if (m.ruleId === "route") {
        const p = stripQuotes(m.node.get("PATH") ?? "");
        if (!p) continue;
        const handler = m.node.get("HANDLER") ?? "";
        const method = methodFromHandler(handler);
        if (!method) continue;
        const isActix = /^\s*web::/.test(handler);
        const layerM = handler.match(/\.layer\(([^)]*)\)/);
        const layerNames =
          layerM?.[1]
            ?.split(",")
            .map((s) => s.trim())
            .filter((s) => AUTH_HINTS.test(s)) ?? [];
        const body = schemaFromHandler(handler);
        routes.push({
          id: makeId("rs", method, p, m.file, m.line),
          method,
          path: p,
          file: m.file,
          line: m.line,
          framework: isActix ? "actix-web" : "axum",
          language: "rust",
          auth: {
            required: layerNames.length > 0,
            middleware: layerNames.length ? layerNames : undefined,
            confidence: layerNames.length ? "medium" : "low",
          },
          body: body.schemaName ? body : undefined,
          params: extractParams(p),
          handlerName: handler.slice(0, 100),
          raw: m.text.slice(0, 500),
        });
      } else if (m.ruleId === "actix-decorator" || m.ruleId === "actix-route-attr") {
        const name = m.node.get("METHOD") ?? "";
        let methodRaw = name.toUpperCase();
        let p = stripQuotes(m.node.get("PATH") ?? "");
        if (name === "route") {
          const mm = m.text.match(/method\s*=\s*["'](\w+)["']/);
          methodRaw = mm?.[1]?.toUpperCase() ?? "ALL";
        }
        if (!p || (!isHttpMethod(methodRaw) && methodRaw !== "ALL")) continue;
        const attached = attachFunction(m.node, m.text);
        const fnText = attached?.fnText ?? "";
        const attrsText = attached?.attrs.join(" ") ?? "";
        const auth = /middleware/.test(attrsText) && AUTH_HINTS.test(attrsText);
        const body = schemaFromHandler(fnText);
        routes.push({
          id: makeId("rs", methodRaw, p, m.file, m.line),
          method: methodRaw as HttpMethod,
          path: p,
          file: m.file,
          line: m.line,
          framework: "actix-web",
          language: "rust",
          auth: {
            required: auth,
            middleware: auth ? ["actix-middleware"] : undefined,
            confidence: auth ? "medium" : "low",
          },
          body: body.schemaName ? body : undefined,
          params: extractParams(p),
          raw: fnText.slice(0, 500),
        });
      }
    }

    return routes;
  },
};
