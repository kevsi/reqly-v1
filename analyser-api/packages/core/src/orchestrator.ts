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
import type { AnalysisResult, ApiRoute, AstGrepMatch, Detector } from "./types.ts";

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
  const out: R[] = new Array(items.length);
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
        const matches = await runRules(langForFile(file, detector.language), src, detector.rules);
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
