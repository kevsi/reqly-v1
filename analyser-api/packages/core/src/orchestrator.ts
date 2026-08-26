import { promises as fs } from "node:fs";
import * as path from "node:path";
import { langForFile, runRules } from "./ast-grep.ts";
import {
  collectSourceFiles,
  detectLanguages,
  findManifestFiles,
  parseGitignore,
  readAnalyserConfig,
} from "./scanner.ts";
import { dedupeRoutes } from "./helpers.ts";
import type { AnalysisResult, ApiRoute, AstGrepMatch, Detector, HttpMethod, RegexRule } from "./types.ts";

function runRegexRules(src: string, rules: RegexRule[]): AstGrepMatch[] {
  const out: AstGrepMatch[] = [];
  for (const rule of rules) {
    for (const m of src.matchAll(rule.pattern)) {
      const line = src.slice(0, m.index).split("\n").length;
      const text = m[0];
      const capture = (name: string): string | undefined => {
        if (rule.capture && name in rule.capture) return m[rule.capture[name]!];
        return m.groups?.[name];
      };
      const node: AstGrepMatch["node"] = {
        text: () => text,
        kind: () => rule.id,
        line: () => line,
        get: capture,
        getAll: (name: string) => {
          const v = capture(name);
          return v ? [v] : [];
        },
        parent: () => null,
        children: () => [],
      };
      out.push({ ruleId: rule.id, file: "", lang: "", line, text, node });
    }
  }
  return out;
}

export interface AnalyzeOptions {
  rootPath: string;
  detectors: Detector[];
  /** restrict to these languages */
  langs?: string[];
  /** max concurrent file parses (default 16) */
  concurrency?: number;
  onFile?: (file: string) => void;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = Array.from<R | undefined>({ length: items.length }) as R[];
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  const { rootPath, detectors, langs } = options;
  const concurrency = options.concurrency ?? 16;
  const warnings: string[] = [];

  const [manifestFiles, config, rootGitignore] = await Promise.all([
    findManifestFiles(rootPath),
    readAnalyserConfig(rootPath),
    fs
      .readFile(path.join(rootPath, ".gitignore"), "utf8")
      .then(parseGitignore)
      .catch(() => [] as string[]),
  ]);
  const gitignore = [...rootGitignore, ...(config.ignore ?? [])];
  let detectedLangs = detectLanguages(manifestFiles);
  let fromManifest = detectedLangs.length > 0;

  if (detectedLangs.length === 0) {
    // Fallback: infer languages from source files when no manifest exists.
    const present = new Set<string>();
    for (const d of detectors) {
      const files = await collectSourceFiles(rootPath, d.extensions, d.ignoreDirs, gitignore);
      if (files.length > 0) present.add(d.language);
    }
    detectedLangs = [...present];
    if (detectedLangs.length === 0) {
      warnings.push("No manifest file and no supported source files found.");
    } else {
      warnings.push(
        "No manifest file found; languages inferred from source files. Confidence may be lower.",
      );
    }
  }

  const active = detectors.filter((d) => {
    if (!detectedLangs.includes(d.language)) return false;
    if (langs && langs.length > 0 && !langs.includes(d.language)) return false;
    return true;
  });

  const frameworks = new Set<string>();
  const allRoutes: ApiRoute[] = [];
  const seenRoutes = new Set<string>();

  function methodFromFile(file: string): HttpMethod | undefined {
    const base = path.basename(file, path.extname(file)).toLowerCase();
    const map: Record<string, HttpMethod> = {
      ajouter: "POST", creer: "POST", create: "POST", add: "POST", insert: "POST",
      modifier: "PUT", update: "PUT", editer: "PUT",
      supprimer: "DELETE", delete: "DELETE", remove: "DELETE",
      rechercher: "GET", trouver: "GET", lister: "GET", get: "GET", index: "GET",
      rechercherun: "GET", show: "GET",
      recherchertous: "GET", all: "GET", list: "GET",
    };
    const m = map[base];
    if (m) return m;
    const upper = base.toUpperCase();
    if (["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"].includes(upper)) return upper as HttpMethod;
    return undefined;
  }

  function languageFromFile(file: string): string {
    switch (path.extname(file).toLowerCase()) {
      case ".php": return "php";
      case ".js": case ".mjs": case ".cjs": case ".jsx": return "javascript";
      case ".ts": case ".tsx": return "typescript";
      case ".py": return "python";
      case ".java": return "java";
      case ".cs": return "csharp";
      case ".rb": return "ruby";
      case ".go": return "go";
      case ".rs": return "rust";
      default: return "unknown";
    }
  }

  for (const detector of active) {
    if (fromManifest && !detector.canHandle(manifestFiles, rootPath)) continue;

    const files = await collectSourceFiles(
      rootPath,
      detector.extensions,
      detector.ignoreDirs,
      gitignore,
    );

    const perFile = await mapWithConcurrency(files, concurrency, async (file) => {
      options.onFile?.(file);
      try {
        const src = await fs.readFile(file, "utf8");
        let matches: AstGrepMatch[];
        try {
          matches = await runRules(langForFile(file, detector.language), src, detector.rules);
        } catch {
          // ast-grep does not support this language (e.g. PHP); fall back to
          // regex-based rules if the detector provides them.
          if (detector.regexRules && detector.regexRules.length > 0) {
            matches = runRegexRules(src, detector.regexRules);
          } else {
            throw new Error(`No ast-grep support for ${detector.language} and no regex fallback`);
          }
        }
        return matches.map((m) => ({ ...m, file })) satisfies AstGrepMatch[];
      } catch (err) {
        warnings.push(`Skipped ${file}: ${String(err instanceof Error ? err.message : err)}`);
        return [];
      }
    });

    const matches = perFile.flat();
    const routes = detector.assemble(matches, rootPath);
    for (const r of routes) frameworks.add(r.framework);
    allRoutes.push(...routes);
  }

  // Generic file-structure fallback: only when no manifest was found
  // (custom projects without framework). In manifest-based projects the
  // detectors are authoritative — spurious fs-routes would pollute the report.
  if (allRoutes.length === 0 && !fromManifest) {
    const fallbackExtensions = [
      ".php", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
      ".py", ".java", ".cs", ".rb", ".go", ".rs",
    ];
    const fallbackFiles = await collectSourceFiles(
      rootPath,
      fallbackExtensions,
      ["vendor", "node_modules"],
      gitignore,
    );
    for (const file of fallbackFiles) {
      const rel = path.relative(rootPath, file).replace(/\\/g, "/");
      const dir = path.dirname(rel).replace(/\\/g, "/");
      // Skip files in root directory (no resource context).
      if (dir === "." || dir === "") continue;
      const resource = dir.split("/").pop() ?? "";
      if (!resource) continue;
      const method = methodFromFile(file);
      if (!method) continue;
      const routePath = `/${resource}`;
      const key = `${method} ${routePath}`;
      if (seenRoutes.has(key)) continue;
      seenRoutes.add(key);
      const src = await fs.readFile(file, "utf8");
      // First non-empty, non-comment line: a stable anchor for the report.
      let idx = src.split("\n").findIndex((l) => {
        const t = l.trim();
        return t.length > 0 && !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("/*");
      });
      if (idx < 0) idx = 0;
      const line = idx + 1;
      allRoutes.push({
        id: `fs-${method.toLowerCase()}-${routePath.replace(/[^a-z0-9]/gi, "-")}`,
        method,
        path: routePath,
        file,
        line,
        framework: "custom",
        language: languageFromFile(file),
        auth: { required: false, confidence: "low" },
        params: [],
        raw: `File-based route: ${rel}`,
      });
    }
    if (allRoutes.length > 0) {
      frameworks.add("custom");
      warnings.push(
        "No framework-specific routes detected; routes inferred from file structure. Confidence is low.",
      );
    } else if (fallbackFiles.length > 0) {
      warnings.push(
        "Source files found but no routes could be inferred from the file structure.",
      );
    }
  }

  const routes = dedupeRoutes(allRoutes);
  const withAuth = routes.filter((r) => r.auth.required);
  const withoutAuth = routes.filter((r) => !r.auth.required);
  const frameworksDetected = [...frameworks];

  return {
    projectName: path.basename(rootPath) || rootPath,
    rootPath,
    scannedAt: new Date().toISOString(),
    languagesDetected: detectedLangs,
    frameworksDetected,
    totalRoutes: routes.length,
    routesWithAuth: withAuth.length,
    routesWithoutAuth: withoutAuth.length,
    stats: {
      total: routes.length,
      withAuth: withAuth.length,
      withoutAuth: withoutAuth.length,
      confidence: {
        high: routes.filter((r) => r.auth.confidence === "high").length,
        medium: routes.filter((r) => r.auth.confidence === "medium").length,
        low: routes.filter((r) => r.auth.confidence === "low").length,
      },
    },
    routes,
    warnings,
  };
}
