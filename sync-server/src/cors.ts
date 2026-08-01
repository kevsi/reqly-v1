/**
 * CORS origin parsing for the sync-server.
 */

/**
 * Parse the ALLOWED_ORIGIN environment variable into a list of allowed origins
 * or the wildcard "*".
 *
 * - If unset: returns the default list of local dev origins.
 * - If "*": returns "*" (logs a warning in production).
 * - Otherwise: splits on commas and trims each entry.
 */
export function parseOrigins(): string[] | "*" {
  const env = process.env.ALLOWED_ORIGIN;
  const isProd = process.env.NODE_ENV === "production";

  if (!env) {
    // Default: local dev origins
    return [
      "http://localhost:3000",
      "http://localhost:4173",
      "tauri://localhost",
      "https://tauri.localhost",
    ];
  }

  if (env === "*") {
    if (isProd) {
      // Wildcard CORS in production disables cookie-based auth (credentials: false).
      // Log a warning so operators know the auth model has changed.
      console.warn(
        "[cors] ALLOWED_ORIGIN=* is set in production. " +
          "Credentials will NOT be sent. Use specific origins for secure auth.",
      );
    }
    return "*";
  }

  return env
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
