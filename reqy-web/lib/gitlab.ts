/**
 * GitLab API client — used server-side via the proxy route.
 *
 * Endpoints used:
 *   GET /projects           → list projects
 *   GET /projects/:id/repository/tree   → browse files
 *   GET /projects/:id/repository/files/:path/raw → get file content
 */

const GITLAB_API_BASE = "https://gitlab.com/api/v4";
const TIMEOUT_MS = 15000;

export class GitLabApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

async function gitlabFetch(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${GITLAB_API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "Reqly/1.0",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string;
  avatar_url: string | null;
}

export interface GitLabTreeItem {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
}

// ─── API methods ───────────────────────────────────────────────────────────

export async function listProjects(token: string, search?: string): Promise<GitLabProject[]> {
  const params = new URLSearchParams({
    membership: "true",
    per_page: "50",
    order_by: "last_activity_at",
    sort: "desc",
  });
  if (search) params.set("search", search);

  const res = await gitlabFetch(token, `/projects?${params}`);
  if (!res.ok) {
    throw new GitLabApiError(res.status, `Erreur GitLab (HTTP ${res.status})`);
  }
  return res.json();
}

export async function listRepoTree(
  token: string,
  projectId: number,
  path?: string,
  ref?: string,
): Promise<GitLabTreeItem[]> {
  const params = new URLSearchParams({
    per_page: "100",
    recursive: "false",
  });
  if (path) params.set("path", path);
  if (ref) params.set("ref", ref);

  const res = await gitlabFetch(token, `/projects/${projectId}/repository/tree?${params}`);
  if (!res.ok) {
    throw new GitLabApiError(res.status, `Erreur GitLab (HTTP ${res.status})`);
  }
  return res.json();
}

/**
 * Get the raw content of a file from a GitLab repository.
 * The file path must be URL-encoded according to GitLab's convention:
 *   - Each segment is URI-encoded individually
 *   - The slash between segments is preserved
 */
export async function getFileRawContent(
  token: string,
  projectId: number,
  filePath: string,
  ref?: string,
): Promise<string> {
  // GitLab expects the path segments to be URI-encoded individually,
  // with the / between segments preserved as literal slashes.
  const encodedPath = filePath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  let url = `/projects/${projectId}/repository/files/${encodeURIComponent(encodedPath)}/raw`;
  if (ref) {
    url += `?ref=${encodeURIComponent(ref)}`;
  }

  const res = await gitlabFetch(token, url);
  if (!res.ok) {
    throw new GitLabApiError(
      res.status,
      `Impossible de lire le fichier ${filePath} (HTTP ${res.status})`,
    );
  }

  // GitLab returns raw content as text for non-binary files
  return res.text();
}

// ─── File type detection ───────────────────────────────────────────────────

export type DetectedFileType =
  "openapi-json" | "openapi-yaml" | "postman" | "bruno" | "bruno-bundle" | "unknown";

const BRUNO_BUNDLE_FILES = new Set(["bruno.json", "collection.json", "bundle.json"]);

export function detectFileType(fileName: string): DetectedFileType {
  const lower = fileName.toLowerCase();

  // .bru files = Bruno individual request
  if (lower.endsWith(".bru")) return "bruno";

  // Bruno bundle JSON files
  const baseName = lower.split("/").pop() || lower;
  if (baseName === "bruno.json") return "bruno-bundle";

  // JSON files
  if (lower.endsWith(".json")) {
    // Postman collections (v2.1)
    if (baseName.includes("postman") || lower.includes("collection.json")) {
      return "postman";
    }
    // Bruno bundle
    if (BRUNO_BUNDLE_FILES.has(baseName)) return "bruno-bundle";
    // OpenAPI (common naming patterns)
    if (
      lower.includes("openapi") ||
      lower.includes("swagger") ||
      lower.includes("api-spec") ||
      lower.includes("api specification")
    ) {
      return "openapi-json";
    }
    // If the folder path contains a Bruno collection hint, treat it as bruno bundle
    return "unknown";
  }

  // YAML files
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    if (lower.includes("openapi") || lower.includes("swagger") || lower.includes("api-spec")) {
      return "openapi-yaml";
    }
    return "unknown";
  }

  return "unknown";
}

export function getFileTypeLabel(type: DetectedFileType): string {
  switch (type) {
    case "openapi-json":
      return "OpenAPI (JSON)";
    case "openapi-yaml":
      return "OpenAPI (YAML)";
    case "postman":
      return "Collection Postman";
    case "bruno":
      return "Requête Bruno";
    case "bruno-bundle":
      return "Collection Bruno";
    case "unknown":
      return "Inconnu";
  }
}
