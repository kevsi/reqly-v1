import * as path from "node:path";
import { extractParams, makeId, stripQuotes } from "@analyser/core";
import type { ApiRoute, AstGrepMatch, AstGrepRule, Detector, HttpMethod } from "@analyser/core";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "Any"]);

const RULES: AstGrepRule[] = [
  { id: "binding", pattern: "$NAME := $INIT" },
  { id: "route", pattern: "$ROUTER.$METHOD($PATH, $HANDLER)" },
];

export const detectorGo: Detector = {
  name: "detector-go",
  language: "go",
  frameworks: ["gin", "echo"],
  extensions: [".go"],
  ignoreDirs: ["vendor"],
  canHandle(manifestFiles) {
    return manifestFiles.some((f) => path.basename(f) === "go.mod");
  },
  rules: RULES,
  assemble(matches: AstGrepMatch[], rootPath?: string): ApiRoute[] {
    const routes: ApiRoute[] = [];
    void rootPath;

    // router name -> { init }
    const routers = new Map<string, Map<string, { init: string }>>();
    for (const m of matches) {
      if (m.ruleId !== "binding") continue;
      const name = m.node.get("NAME");
      const init = m.node.get("INIT") ?? "";
      if (!name || !/(gin\.New|gin\.Default|echo\.New|\.Group\()/.test(init)) continue;
      let map = routers.get(m.file);
      if (!map) {
        map = new Map();
        routers.set(m.file, map);
      }
      if (!map.has(name)) map.set(name, { init });
    }

    for (const m of matches) {
      if (m.ruleId !== "route") continue;
      const methodRaw = m.node.get("METHOD") ?? "";
      if (!METHODS.has(methodRaw)) continue;
      const p = stripQuotes(m.node.get("PATH") ?? "");
      if (!p) continue;
      const router = m.node.get("ROUTER") ?? "";
      const handler = m.node.get("HANDLER") ?? "";
      const init = routers.get(m.file)?.get(router)?.init ?? "";
      const isAuthGroup = /\.Group\(/.test(init);
      const framework = /echo\.New/.test(init) ? "echo" : "gin";
      const bodyM =
        handler.match(/ShouldBindJSON\(&(\w+)\)/) ??
        handler.match(/Bind\(&(\w+)\)/) ??
        handler.match(/Decode\(&(\w+)\)/);
      const finalMethod = (methodRaw === "Any" ? "ALL" : methodRaw.toUpperCase()) as HttpMethod;
      routes.push({
        id: makeId("go", finalMethod, p, m.file, m.line),
        method: finalMethod,
        path: p,
        file: m.file,
        line: m.line,
        framework,
        language: "go",
        auth: {
          required: isAuthGroup,
          middleware: isAuthGroup ? [router] : undefined,
          confidence: isAuthGroup ? "high" : "low",
        },
        body: bodyM?.[1] ? { contentType: "application/json", schemaName: bodyM[1] } : undefined,
        params: extractParams(p),
        handlerName: handler,
        raw: m.text.slice(0, 300),
      });
    }

    return routes;
  },
};
