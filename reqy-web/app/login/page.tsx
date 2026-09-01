"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/lib/session-store";
import { isTauriAvailable } from "@/lib/tauri";
import { AuthBrandPanel } from "@/components/auth-brand-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from "lucide-react";

const OAUTH_ERRORS: Record<string, string> = {
  github_not_configured: "La connexion GitHub n'est pas configurée sur le serveur.",
  github_token_failed: "Impossible d'obtenir le token GitHub. Réessayez.",
  github_profile_failed: "Impossible de récupérer votre profil GitHub.",
  github_no_email: "Aucun email public trouvé sur votre compte GitHub.",
  github_state_invalid: "Session OAuth expirée. Réessayez.",
  sync_not_configured: "Le serveur de synchronisation n'est pas configuré.",
  sync_failed: "Erreur de connexion au serveur. Réessayez.",
};

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useSessionStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Read OAuth error from URL query params. Derived once from the initial
  // searchParams value instead of setState-in-effect.
  const [oauthError] = useState(() => {
    const code = searchParams.get("error");
    return code ? OAUTH_ERRORS[code] || `Erreur OAuth: ${code}` : null;
  });
  useEffect(() => {
    if (oauthError) {
      // Clean up the URL so a refresh doesn't re-show the stale error
      window.history.replaceState({}, "", "/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.push("/");
    } catch (err) {
      if (
        err instanceof Error &&
        (err as Error & { needsVerification?: boolean }).needsVerification
      ) {
        // Redirect to verification page — a code was already sent on signup
        const verifyEmail = (err as Error & { email?: string }).email || email.trim();
        router.push(`/signup?verify=${encodeURIComponent(verifyEmail)}`);
        return;
      }
      setError(err instanceof Error ? err.message : t("authPage.login.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthBrandPanel />

      {/* ── Form panel ───────────────────────────────────────────────────── */}
      <section className="relative flex items-center justify-center bg-background px-4 py-12 sm:px-8">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Compact logo for mobile / small screens */}
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
              R
            </div>
            <span className="text-base font-semibold">Reqly</span>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/[0.04] sm:p-8">
            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">
              {t("authPage.login.title")}
            </h1>
            <p className="mb-7 text-sm text-muted-foreground">{t("authPage.login.description")}</p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">{t("authPage.email")}</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("authPage.emailPlaceholder")}
                  autoFocus
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">{t("authPage.password")}</Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11"
                />
              </div>

              {(error || oauthError) && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p className="text-sm text-destructive">{error || oauthError}</p>
                  </div>
                </div>
              )}

              <Button type="submit" disabled={loading} className="h-11 w-full" size="lg">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {t("authPage.login.submitting")}
                  </span>
                ) : (
                  t("authPage.login.submit")
                )}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide">
                <span className="bg-card px-3 text-muted-foreground">{t("authPage.or")}</span>
              </div>
            </div>

            <a
              href={`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/github-login/start`}
              className="block w-full"
            >
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full transition-colors hover:bg-accent"
                size="lg"
                onClick={(e) => {
                  // IMPORTANT: preventDefault must run synchronously, before any
                  // await — otherwise the <a> navigation already proceeds.
                  if (!isTauriAvailable()) return; // Web: let the <a> navigate normally
                  e.preventDefault();

                  const run = async () => {
                    try {
                      const { invoke } = await import("@tauri-apps/api/core");
                      const syncUrl =
                        process.env.NEXT_PUBLIC_SYNC_URL || "https://reqly.duckdns.org";
                      // Start local loopback server and get the GitHub auth URL.
                      // The public client_id is resolved from the process
                      // environment on the Rust side (never crosses the IPC
                      // boundary).
                      const authUrl = await invoke<string>("start_github_oauth_server", {
                        syncServerUrl: syncUrl,
                      });
                      // Open the auth URL in the system browser
                      await invoke("open_external", { url: authUrl });
                    } catch (err) {
                      console.error("[login] GitHub OAuth error:", err);
                      window.alert(`Erreur GitHub login : ${String(err)}`);
                    }
                  };
                  void run();
                }}
              >
                <svg className="mr-2 size-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Se connecter avec GitHub
              </Button>
            </a>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t("authPage.login.noAccount")}{" "}
              <Link
                href="/signup"
                className="font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                {t("authPage.login.signUp")}
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
