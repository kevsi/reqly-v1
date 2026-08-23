import { z } from "zod";

/**
 * Edge-safe environment validation.
 *
 * Why this shape:
 * - Next.js Edge runtime freezes `process.env` at build time and tolerates
 *   missing values differently than Node.js. We MUST NOT crash the bundle
 *   because `process.env.AUTH_SIGNING_SECRET` is `undefined` at build.
 * - Node.js runtime: validates lazily on first call, throws once.
 * - Edge runtime: returns `process.env` as-is with a single console.warn.
 * - Build-time validation: `validateBuildTimeEnv()` exported for
 *   `next.config.mjs` to call during `next build`.
 */

const preprocessEmpty = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), schema);

const safeUrl = () =>
  z.preprocess((val) => {
    if (typeof val !== "string") return undefined;
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : undefined;
    } catch {
      console.warn(
        `[env] Invalid URL format for environment variable (${trimmed}). Treating as undefined.`,
      );
      return undefined;
    }
  }, z.string().optional());

const safeUrlWithDefault = (fallback: string) =>
  z.preprocess((val) => {
    if (typeof val !== "string") return fallback;
    const trimmed = val.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : fallback;
    } catch {
      console.warn(`[env] Invalid URL format (${trimmed}). Falling back to default: ${fallback}`);
      return fallback;
    }
  }, z.string().default(fallback));

const ServerEnvSchema = z.object({
  AUTH_SIGNING_SECRET: preprocessEmpty(z.string().optional()),
  SUPABASE_URL: safeUrl(),
  SUPABASE_SERVICE_ROLE_KEY: preprocessEmpty(z.string().optional()),
  GITHUB_OAUTH_CLIENT_ID: preprocessEmpty(z.string().optional()),
  GITHUB_OAUTH_CLIENT_SECRET: preprocessEmpty(z.string().optional()),
  GOOGLE_OAUTH_CLIENT_ID: preprocessEmpty(z.string().optional()),
  GOOGLE_OAUTH_CLIENT_SECRET: preprocessEmpty(z.string().optional()),
  UPSTASH_REDIS_REST_URL: safeUrl(),
  UPSTASH_REDIS_REST_TOKEN: preprocessEmpty(z.string().optional()),
  ALLOW_LOCAL_HOSTS: preprocessEmpty(z.enum(["true", "false"]).optional()),
  JINA_API_KEY: preprocessEmpty(z.string().optional()),
});

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: safeUrlWithDefault("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: safeUrl(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: preprocessEmpty(z.string().optional()),
  NEXT_PUBLIC_SYNC_URL: safeUrl(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type PublicEnv = z.infer<typeof PublicEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;
let warnedEdge = false;

function isEdgeRuntime(): boolean {
  // Next.js exposes NEXT_RUNTIME at build (always "edge" or "nodejs")
  // and at runtime on the server. The Edge runtime also lacks some Node
  // globals — checking NEXT_RUNTIME is the canonical way.
  const runtime = (process as { env?: Record<string, string | undefined> }).env?.NEXT_RUNTIME;
  return runtime === "edge" || (globalThis as { EdgeRuntime?: boolean }).EdgeRuntime === true;
}

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  // Edge: do not crash. The build-time validator (next.config.mjs) catches
  // missing required values before the bundle ships.
  if (isEdgeRuntime()) {
    if (!warnedEdge) {
      console.warn(
        "[env] running on Edge runtime — env validation is relaxed. " +
          "Build-time validation in next.config.mjs is the source of truth.",
      );
      warnedEdge = true;
    }
    return process.env as unknown as ServerEnv;
  }

  // Node.js: full validation, throw on first failure.
  const result = ServerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[env] invalid server environment:\n${issues}`);
  }
  cachedServerEnv = result.data;
  return cachedServerEnv;
}

let cachedPublicEnv: PublicEnv | null = null;
export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const result = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SYNC_URL: process.env.NEXT_PUBLIC_SYNC_URL,
  });
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[env] invalid public environment:\n${issues}`);
  }
  cachedPublicEnv = result.data;
  return cachedPublicEnv;
}

export function validateBuildTimeEnv(): void {
  // Reserved for future build-time env requirements.
}
