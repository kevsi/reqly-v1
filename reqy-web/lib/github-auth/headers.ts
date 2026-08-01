/**
 * Shared GitHub API helpers. Previously duplicated in
 * `app/api/github-auth/repos/route.ts` and `app/api/github-auth/status/route.ts`
 * — both files had identical implementations of `buildGithubHeaders`.
 */

export const GITHUB_API_VERSION = "2022-11-28"

export function buildGithubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "api-playground",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  }
}
