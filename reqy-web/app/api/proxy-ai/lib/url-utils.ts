import { isIP } from "node:net";
import { isBlockedIp } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";

const BLOCKED_HOSTNAME_TOKENS = new Set([
  "localhost",
  "localdomain",
  "local",
  "internal",
  "private",
  "intranet",
  "corp",
  "home",
  "lan",
]);

function isHostnameBlocked(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  if (!lower) return true;
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "0.0.0.0" || lower === "::1") {
    return true;
  }
  const labels = lower.split(".");
  return labels.some((label) => {
    if (!label) return false;
    if (BLOCKED_HOSTNAME_TOKENS.has(label)) return true;
    return label.endsWith("local") || label.endsWith("internal");
  });
}

async function resolveHostIfNeeded(hostname: string): Promise<string | null> {
  if (isIP(hostname)) return hostname;
  return await resolveCached(hostname);
}

export async function getCustomUrl(body: Record<string, unknown>): Promise<string> {
  const raw = typeof body.openaiUrl === "string" ? body.openaiUrl.trim() : "";
  if (!raw) {
    throw new Error("Custom provider requires a base URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid custom provider URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use http or https");
  }
  if (isHostnameBlocked(parsed.hostname)) {
    throw new Error("Custom provider URL cannot point to localhost or private IP");
  }

  const resolved = await resolveHostIfNeeded(parsed.hostname);
  if (!resolved || isBlockedIp(resolved)) {
    throw new Error("Custom provider URL cannot point to localhost or private IP");
  }

  return raw.replace(/\/+$/, "") + "/chat/completions";
}

export async function isOllamaHostAllowed(host: string): Promise<boolean> {
  const lower = host.toLowerCase().trim();
  if (!lower) return false;

  // Ollama est un service local explicite : l'utilisateur choisit délibérément
  // ce provider. localhost/127.0.0.1/::1 sont autorisés (usage normal).
  // Les autres IP privées sont bloquées (SSRF).
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "0.0.0.0" || lower === "::1") {
    return true;
  }

  if (isIP(lower) && isBlockedIp(lower)) return false;

  const resolved = await resolveHostIfNeeded(lower);
  if (!resolved) return false;
  return !isBlockedIp(resolved);
}

/**
 * Validate a user-supplied provider base URL (custom/OpenAI-compatible) against
 * the SSRF guard. Throws if it points at localhost, a private/reserved IP, or a
 * hostname that resolves to one (DNS-rebinding prevention). Shared by routes
 * that take a client-controlled `baseUrl` and fetch it server-side.
 */
export async function assertSafeBaseUrl(raw: string): Promise<string> {
  const trimmed = (raw ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid custom provider URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use http or https");
  }
  if (isHostnameBlocked(parsed.hostname)) {
    throw new Error("Custom provider URL cannot point to localhost or private IP");
  }
  const resolved = await resolveHostIfNeeded(parsed.hostname);
  if (!resolved || isBlockedIp(resolved)) {
    throw new Error("Custom provider URL cannot point to localhost or private IP");
  }
  return trimmed;
}
