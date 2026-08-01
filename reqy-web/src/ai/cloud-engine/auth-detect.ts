/**
 * Phase 6.2 — Auth type detection + header auto-completion
 *
 * Heuristics only — no LLM calls. Detects auth type from URL patterns and
 * a free-form hint (e.g. the natural language description), then returns
 * the standard set of headers (and template values) for that auth type.
 */
import type { AuthType } from "@/src/ai/types";

interface AuthServicePattern {
  /** Match against hostname + path. */
  pattern: RegExp;
  authType: AuthType;
  /** Header name(s) that should be set. */
  headers: string[];
  /** Default template value (uses {{env_var}} placeholders). */
  template: Record<string, string>;
}

/**
 * Curated list of well-known APIs and their typical auth pattern.
 * Order matters: more specific patterns come first.
 */
const KNOWN_PATTERNS: AuthServicePattern[] = [
  // GitHub
  { pattern: /api\.github\.com/i, authType: "bearer", headers: ["Authorization"], template: { Authorization: "Bearer {{GITHUB_TOKEN}}" } },
  // Stripe
  { pattern: /api\.stripe\.com/i, authType: "bearer", headers: ["Authorization"], template: { Authorization: "Bearer {{STRIPE_API_KEY}}" } },
  // OpenAI
  { pattern: /api\.openai\.com/i, authType: "bearer", headers: ["Authorization"], template: { Authorization: "Bearer {{OPENAI_API_KEY}}" } },
  // Anthropic
  { pattern: /api\.anthropic\.com/i, authType: "bearer", headers: ["x-api-key", "anthropic-version"], template: { "x-api-key": "{{ANTHROPIC_API_KEY}}", "anthropic-version": "2023-06-01" } },
  // Supabase
  { pattern: /supabase\.co/i, authType: "apikey", headers: ["apikey", "Authorization"], template: { apikey: "{{SUPABASE_ANON_KEY}}", Authorization: "Bearer {{SUPABASE_ANON_KEY}}" } },
  // Twilio
  { pattern: /api\.twilio\.com/i, authType: "basic", headers: ["Authorization"], template: { Authorization: "Basic {{TWILIO_AUTH}}" } },
  // Basic Auth keyword
  { pattern: /^https?:\/\/[^/]*$/i, authType: "none", headers: [], template: {} },
];

/**
 * Keyword-based detection from the free-form hint (e.g. "GitHub API",
 * "Stripe checkout", "use OAuth"). Light heuristic only.
 */
function detectFromHint(hint: string | undefined): AuthType | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (/oauth2?|authorization code|client credentials|pkce/.test(h)) return "oauth2";
  if (/api[- _]?key|x-api-key|apikey/.test(h)) return "apikey";
  if (/basic auth|username.*password/.test(h)) return "basic";
  if (/bearer|jwt|token/.test(h)) return "bearer";
  return null;
}

export interface DetectedAuth {
  authType: AuthType;
  /** Suggested header keys (with template values). May be empty for "none". */
  headers: Record<string, string>;
  /** Confidence score 0-1. */
  confidence: number;
}

/**
 * Detect the auth type and return a suggested header set.
 *
 * @param url Target URL (used to match against known services).
 * @param hint Optional free-form text (description, keywords).
 */
export function detectAuth(url: string, hint?: string): DetectedAuth {
  // 1. Hint takes priority when it gives a definitive answer.
  const hintType = detectFromHint(hint);
  if (hintType && hintType !== "none") {
    return {
      authType: hintType,
      headers: headersForAuth(hintType),
      confidence: 0.8,
    };
  }

  // 2. Match URL against known services.
  for (const p of KNOWN_PATTERNS) {
    if (p.pattern.test(url)) {
      return {
        authType: p.authType,
        headers: p.template,
        confidence: 0.95,
      };
    }
  }

  // 3. Default: try to guess from URL scheme.
  if (/^https?:\/\/[^/]+/.test(url)) {
    return {
      authType: "none",
      headers: {},
      confidence: 0.3,
    };
  }

  return {
    authType: "none",
    headers: {},
    confidence: 0,
  };
}

/** Standard headers for a given auth type (with {{variable}} placeholders). */
export function headersForAuth(authType: AuthType): Record<string, string> {
  switch (authType) {
    case "bearer":
      return { Authorization: "Bearer {{API_TOKEN}}" };
    case "basic":
      return { Authorization: "Basic {{BASE64_CREDENTIALS}}" };
    case "apikey":
      return { "X-API-Key": "{{API_KEY}}" };
    case "oauth2":
      return { Authorization: "Bearer {{OAUTH_ACCESS_TOKEN}}" };
    case "none":
    default:
      return {};
  }
}

/**
 * Merge detected headers into an existing headers object. Existing keys win.
 */
export function applyAuthHeaders(
  existing: Record<string, string>,
  detected: DetectedAuth
): Record<string, string> {
  if (detected.authType === "none") return existing;
  const out = { ...detected.headers };
  for (const [k, v] of Object.entries(existing)) {
    out[k] = v;
  }
  return out;
}
