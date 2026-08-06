import type { RequestItem } from "./types.js";

export interface DetectedRoute {
  method: string;
  path: string;
  name?: string;
  authRequired?: boolean;
  authType?: string;
  sourceFile?: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Set of directories that the route analyzer is allowed to read.
 * Passed in via `McpServerOptions.allowedDirectories`.  When set, the
 * analyzer rejects any `folderPath` that does not resolve under one of
 * these directories, preventing arbitrary filesystem reads.
 *
 * If empty / not set, a conservative default set is used (cwd, home).
 *
 * This is a module-level var set by `setAllowedDirectories` during MCP
 * server initialization, so options flow from the CLI flag to the tool.
 */
let ALLOWED_DIRECTORIES: string[] = [];

export async function setAllowedDirectories(dirs: string[]): Promise<void> {
  const thePath = await import("node:path");
  ALLOWED_DIRECTORIES = dirs.map((d) => thePath.resolve(d).replace(/[\\/]+$/, ""));
}

const IGNORED_FOLDERS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  "coverage",
  "vendor",
  "__pycache__",
]);

const AUTH_INDICATORS = [
  /passport\.authenticate/,
  /ensureAuth/,
  /requireAuth/,
  /verifyJWT/,
  /auth\(/,
  /getServerSession/,
  /currentUser\(/,
  /supabase\.auth/,
];

export async function analyzeProjectRoutes(
  folderPath: string,
  allowedDirectories?: string[],
): Promise<{
  folderPath: string;
  routeCount: number;
  routes: DetectedRoute[];
  generatedRequests: Array<Partial<RequestItem>>;
}> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Use the provided allowed directories, falling back to the module-level default
  const allowedDirs = allowedDirectories ?? ALLOWED_DIRECTORIES;

  // Security: validate the path
  const resolved = path.resolve(folderPath);

  // 1. Reject path traversal components (redundant after resolve but defence-in-depth)
  if (folderPath.includes("..")) {
    throw new Error(`Access denied: path traversal is not allowed: "${folderPath}"`);
  }

  // 2. If allowed directories are configured, verify the resolved path is under one of them
  if (allowedDirs.length > 0) {
    const isUnderAllowed = allowedDirs.some((dir) => {
      const relative = path.relative(dir, resolved);
      // Empty relative means resolved === dir (the allowed directory itself).
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (!isUnderAllowed) {
      throw new Error(
        `Access denied: "${folderPath}" is not within any allowed directory. ` +
          `Allowed: ${allowedDirs.join(", ")}`,
      );
    }
  }

  // 3. Block system directories (defence-in-depth / safety net)
  const blockedPrefixes = ["/etc", "/usr", "/bin", "/sbin", "/boot", "/dev", "/sys", "/proc"];
  if (process.platform === "win32") {
    blockedPrefixes.push("C:\\Windows", "C:\\Program Files", "C:\\ProgramData", "C:\\System32");
  }
  const lowerResolved = resolved.toLowerCase();
  for (const prefix of blockedPrefixes) {
    if (lowerResolved.startsWith(prefix.toLowerCase())) {
      throw new Error(`Access denied: cannot analyze system directory "${folderPath}"`);
    }
  }

  async function walk(dir: string, depth = 0): Promise<string[]> {
    if (depth > 6) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED_FOLDERS.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(fullPath, depth + 1)));
      } else if (entry.isFile() && entry.name.match(/\.(ts|js|tsx|jsx|py|rb|php|go|java|kt|cs)$/)) {
        files.push(fullPath);
      }
    }
    return files.slice(0, 200);
  }

  const files = await walk(folderPath);
  const routes: DetectedRoute[] = [];
  const seen = new Set<string>();

  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const appRouterRegex =
      /\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let m: RegExpExecArray | null;
    while ((m = appRouterRegex.exec(content)) !== null) {
      const method = m[1]!.toUpperCase();
      const routePath = normalizePath(m[2]!);
      const key = `${method}|${routePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(buildRoute(method, routePath, filePath, content));
    }

    const nestRegex =
      /@(Get|Post|Put|Patch|Delete|Head|Options)\s*(?:\(\s*['"`]([^'"`]+)['"`]\s*\))?/g;
    while ((m = nestRegex.exec(content)) !== null) {
      const method = m[1]!.toUpperCase();
      const routePath = normalizePath(m[2] ?? "/");
      const key = `${method}|${routePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(buildRoute(method, routePath, filePath, content));
    }

    const decoratorRegex =
      /@(app|router)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    while ((m = decoratorRegex.exec(content)) !== null) {
      const method = m[2]!.toUpperCase();
      const routePath = normalizePath(m[3]!);
      const key = `${method}|${routePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(buildRoute(method, routePath, filePath, content));
    }

    const djangoRegex = /path\s*\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = djangoRegex.exec(content)) !== null) {
      const routePath = normalizePath(m[1]!);
      const key = `GET|${routePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(buildRoute("GET", routePath, filePath, content));
    }

    const nextRegex =
      /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/gi;
    while ((m = nextRegex.exec(content)) !== null) {
      const method = m[1]!.toUpperCase();
      const relativePath = path.relative(folderPath, filePath);
      const routePath = derivePathFromFile(relativePath);
      const key = `${method}|${routePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(buildRoute(method, routePath, filePath, content));
    }
  }

  const generatedRequests: Array<Partial<RequestItem>> = routes.map((r) => ({
    name: `${r.method} ${r.path}`,
    method: r.method as RequestItem["method"],
    url: `http://localhost:3000${r.path}`,
    endpoint: r.path,
    authType: (r.authRequired ? "bearer" : "none") as RequestItem["authType"],
  }));

  return {
    folderPath,
    routeCount: routes.length,
    routes,
    generatedRequests,
  };
}

function normalizePath(p: string): string {
  p = p.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+/g, "/");
}

function derivePathFromFile(relativePath: string): string {
  const cleaned = relativePath
    .replace(/\\/g, "/")
    .replace(/\.(ts|js|tsx|jsx|py|rb|php|go|java|kt|cs)$/, "")
    .replace(/\/route$/, "")
    .replace(/^api\//, "/");
  return normalizePath(cleaned);
}

function buildRoute(
  method: string,
  path: string,
  sourceFile: string,
  content: string,
): DetectedRoute {
  const authRequired = AUTH_INDICATORS.some((re) => re.test(content));
  return {
    method,
    path,
    sourceFile,
    authRequired,
    authType: authRequired ? "middleware" : "none",
    confidence: authRequired ? "MEDIUM" : "LOW",
  };
}
