/**
 * Classification unifiée des erreurs providers IA — partagée web (proxy) et
 * desktop (Tauri). Traduit les formats hétérogènes des 7 providers vers des
 * codes stables + messages utilisateur FR + stratégie de retry.
 *
 * Formats reconnus (insensible à la casse) :
 *  - Contexte dépassé : OpenAI « context_length_exceeded » / « maximum context
 *    length », Anthropic « prompt is too long », Gemini « input token limit »…
 *  - Quota épuisé : OpenAI « insufficient_quota » (HTTP 429 mais ≠ rate limit)
 *  - Rate limit : HTTP 429, « rate limit », « TPM », « RPM », « overloaded »
 *  - Auth : 401/403, « invalid api key », « unauthorized », « authentication_error »
 *  - Modèle : 404, « model_not_found », « does not exist »
 */

export type ProviderErrorCode =
  | "rate_limit"
  | "quota_exceeded"
  | "auth_invalid"
  | "model_not_found"
  | "context_too_long"
  | "timeout"
  | "server_error"
  | "network"
  | "unknown";

export interface ClassifiedProviderError {
  code: ProviderErrorCode;
  /** Message utilisateur FR, actionnable, sans JSON brut. */
  userMessage: string;
  /** Un retry automatique est-il pertinent ? */
  retryable: boolean;
  /** Délai suggéré avant retry (ms), ex. depuis Retry-After. */
  retryAfterMs?: number;
  status?: number;
  provider?: string;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(params: {
    code: ProviderErrorCode;
    userMessage: string;
    detail?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(
      params.detail
        ? `${params.userMessage} (${params.detail.slice(0, 180)})`
        : params.userMessage,
    );
    this.name = "ProviderError";
    this.code = params.code;
    this.retryable = params.retryable ?? false;
    this.retryAfterMs = params.retryAfterMs;
  }
}

function matchesAny(lower: string, needles: string[]): boolean {
  return needles.some((n) => lower.includes(n));
}

/** Classe une erreur à partir du statut HTTP + corps/message du provider. */
export function classifyProviderError(input: {
  status?: number;
  message?: string;
  provider?: string;
  retryAfterHeader?: string | null;
}): ClassifiedProviderError {
  const { status, provider } = input;
  const raw = input.message ?? "";
  const lower = raw.toLowerCase();

  const base = { status, provider } as const;

  // ── Contexte dépassé (formats par provider) ──────────────────────────────
  if (
    matchesAny(lower, [
      "context_length_exceeded",
      "maximum context length",
      "prompt is too long",
      "input token limit",
      "context window",
      "too many tokens",
      "request too large",
    ])
  ) {
    return {
      ...base,
      code: "context_too_long",
      userMessage:
        "La conversation est trop longue pour ce modèle. Utilisez /compact ou démarrez une nouvelle session.",
      retryable: false,
    };
  }

  // ── Quota épuisé (OpenAI renvoie 429 + insufficient_quota) ───────────────
  if (matchesAny(lower, ["insufficient_quota", "exceeded your current quota", "billing"])) {
    return {
      ...base,
      code: "quota_exceeded",
      userMessage:
        "Quota du provider épuisé — vérifiez votre facturation ou changez de modèle/provider.",
      retryable: false,
    };
  }

  // ── Rate limit (429 hors quota) ──────────────────────────────────────────
  if (
    status === 429 ||
    matchesAny(lower, ["rate limit", "rate_limit", "requests per minute", " tpmm", "overloaded"])
  ) {
    const retryAfterMs = input.retryAfterHeader
      ? Math.max(0, Number(input.retryAfterHeader) * 1000) || undefined
      : undefined;
    return {
      ...base,
      code: "rate_limit",
      userMessage: "Limite de requêtes du provider atteinte — nouvelle tentative automatique…",
      retryable: true,
      retryAfterMs,
    };
  }

  // ── Auth / clé invalide ─────────────────────────────────────────────────
  if (
    status === 401 ||
    status === 403 ||
    matchesAny(lower, [
      "invalid api key",
      "incorrect api key",
      "unauthorized",
      "authentication_error",
      "api key not valid",
      "permission denied",
    ])
  ) {
    return {
      ...base,
      code: "auth_invalid",
      userMessage: "Clé API invalide ou refusée — vérifiez-la dans Settings.",
      retryable: false,
    };
  }

  // ── Modèle introuvable ──────────────────────────────────────────────────
  if (
    status === 404 ||
    matchesAny(lower, ["model_not_found", "does not exist", "model not found", "unknown model"])
  ) {
    return {
      ...base,
      code: "model_not_found",
      userMessage:
        "Modèle introuvable ou inaccessible — sélectionnez-en un autre dans le sélecteur de modèle.",
      retryable: false,
    };
  }

  // ── Timeout ─────────────────────────────────────────────────────────────
  if (matchesAny(lower, ["timed out", "timeout", "etimedout"])) {
    return {
      ...base,
      code: "timeout",
      userMessage: "Le modèle n'a pas répondu à temps.",
      retryable: true,
      retryAfterMs: 1500,
    };
  }

  // ── Réseau / serveur local injoignable (Ollama éteint…) ─────────────────
  if (
    matchesAny(lower, ["failed to fetch", "econnrefused", "enotfound", "network", "socket"]) ||
    (status !== undefined && status >= 500)
  ) {
    const hint =
      provider === "ollama"
        ? "Impossible de joindre Ollama — vérifiez qu'il est démarré (ollama serve)."
        : "Erreur réseau ou serveur indisponible.";
    return {
      ...base,
      code: status !== undefined && status >= 500 ? "server_error" : "network",
      userMessage: hint,
      retryable: true,
      retryAfterMs: 1200,
    };
  }

  return {
    ...base,
    code: "unknown",
    userMessage: raw
      ? `Erreur du provider : ${raw.slice(0, 160)}`
      : "Erreur de communication avec le provider IA.",
    retryable: false,
  };
}

/** Classe n'importe quelle exception levée par la couche LLM. */
export function classifyThrownError(err: unknown, provider?: string): ClassifiedProviderError {
  if (err instanceof ProviderError) {
    return {
      code: err.code,
      userMessage: err.message,
      retryable: err.retryable,
      retryAfterMs: err.retryAfterMs,
      status: undefined,
      provider,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return classifyProviderError({ message, provider });
}
