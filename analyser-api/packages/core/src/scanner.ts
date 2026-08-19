import { promises as fs } from "node:fs";
import * as path from "node:path";

export const MANIFEST_NAMES = [
  "package.json",
  "Cargo.toml",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "go.mod",
] as const;

export function languageFromManifest(basename: string): string | undefined {
  switch (basename) {
    case "package.json":
      return "javascript";
    case "Cargo.toml":
      return "rust";
    case "requirements.txt":
    case "pyproject.toml":
    case "Pipfile":
      return "python";
    case "go.mod":
      return "go";
    default:
      return undefined;
  }
}

const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".next",
  ".turbo",
  "coverage",
];

/** Minimal gitignore parser: comments and negations are dropped, trailing
 * slashes stripped. Patterns keep their path semantics for matching. */
export function parseGitignore(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => l.replace(/\/$/, ""));
}

/** Checks a name/relative-path against parsed gitignore patterns. */
export function isGitignoreMatch(name: string, relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.startsWith("/")) return relPath === p.slice(1);
    if (p.includes("/")) {
      return relPath === p || relPath.startsWith(p + "/");
    }
    return name === p;
  });
}

export interface AnalyserConfig {
  ignore?: string[];
}

/** Reads `.analyserrc` (JSON) from a root path, if present. */
export async function readAnalyserConfig(rootPath: string): Promise<AnalyserConfig> {
  try {
    const raw = await fs.readFile(path.join(rootPath, ".analyserrc"), "utf8");
    return JSON.parse(raw) as AnalyserConfig;
  } catch {
    return {};
  }
}

/**
 * Finds manifests at root and in immediate subdirectories (monorepo-lite).
 */
export async function findManifestFiles(rootPath: string): Promise<string[]> {
  const manifests: string[] = [];
  const dirs = [rootPath];
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        dirs.push(path.join(rootPath, e.name));
      }
    }
  } catch {
    // rootPath unreadable; just use it as-is
  }
  for (const dir of dirs) {
    for (const name of MANIFEST_NAMES) {
      const p = path.join(dir, name);
      try {
        await fs.access(p);
        manifests.push(p);
      } catch {
        // not present
      }
    }
  }
  return manifests;
}

export function detectLanguages(manifestFiles: string[]): string[] {
  return [
    ...new Set(
      manifestFiles
        .map((f) => languageFromManifest(path.basename(f)))
        .filter((x): x is string => Boolean(x)),
    ),
  ];
}

/**
 * Recursively collects source files matching `extensions`, skipping
 * `ignoreDirs` plus a default set of generated/dependency directories.
 */
export async function collectSourceFiles(
  rootPath: string,
  extensions: readonly string[],
  ignoreDirs: readonly string[] = [],
  gitignore: string[] = [],
): Promise<string[]> {
  const ignored = new Set([...DEFAULT_IGNORES, ...ignoreDirs]);
  const ext = new Set(extensions);
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(rootPath, full).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (ignored.has(e.name) || isGitignoreMatch(e.name, rel, gitignore)) continue;
        await walk(full);
      } else if (ext.has(path.extname(e.name))) {
        if (isGitignoreMatch(e.name, rel, gitignore)) continue;
        files.push(full);
      }
    }
  }

  await walk(rootPath);
  return files;
}
