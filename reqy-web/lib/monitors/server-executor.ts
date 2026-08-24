import { isBlockedIp, isIP, isPrivateHost } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";

/**
 * Executor HTTP côté serveur pour les monitors cloud (route cron).
 * Reproduit la garde SSRF du proxy existant : hôte privé rejeté + vérification
 * de l'IP résolue (anti DNS-rebinding) via le cache DNS partagé.
 */
export interface ServerExecuteInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ServerExecuteResult {
  statusCode: number;
  responseTimeMs: number;
  bodyText: string;
  headersLower: Record<string, string>;
}

export class MonitorRequestError extends Error {
  constructor(
    message: string,
    public readonly kind: "ssrf" | "network" | "timeout" = "network",
  ) {
    super(message);
    this.name = "MonitorRequestError";
  }
}

export async function executeMonitorRequestServer(
  input: ServerExecuteInput,
): Promise<ServerExecuteResult> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new MonitorRequestError(`URL invalide : ${input.url.slice(0, 120)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MonitorRequestError("Protocole non supporté (http/https uniquement)", "ssrf");
  }

  // ── SSRF guard (miroir du proxy) ──────────────────────────────────────
  if (isPrivateHost(parsed.hostname)) {
    throw new MonitorRequestError("Hôte privé/interne interdit", "ssrf");
  }
  if (!isIP(parsed.hostname)) {
    const resolved = await resolveCached(parsed.hostname);
    if (!resolved || isBlockedIp(resolved)) {
      throw new MonitorRequestError(
        "Résolution DNS vers une IP privée/bloquée",
        "ssrf",
      );
    }
  } else if (isBlockedIp(parsed.hostname)) {
    throw new MonitorRequestError("IP privée/bloquée interdite", "ssrf");
  }

  // ── Exécution ─────────────────────────────────────────────────────────
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parsed.toString(), {
      method: input.method,
      headers: Object.keys(input.headers ?? {}).length > 0 ? input.headers : undefined,
      body:
        input.body != null && !["GET", "HEAD"].includes(input.method.toUpperCase())
          ? input.body
          : undefined,
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    const bodyText = (await res.text()).slice(0, 2048);
    const headersLower: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headersLower[key.toLowerCase()] = value;
    });
    return {
      statusCode: res.status,
      responseTimeMs: Date.now() - startedAt,
      bodyText,
      headersLower,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MonitorRequestError(`Timeout après ${timeoutMs} ms`, "timeout");
    }
    throw new MonitorRequestError(
      err instanceof Error ? err.message : "Erreur réseau",
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
}
