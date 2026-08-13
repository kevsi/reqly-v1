"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/lib/session-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const login = useSessionStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {/* Logo / Brand */}
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              R
            </div>
            <span className="text-sm font-semibold">Reqly</span>
          </div>

          <h1 className="mb-1 text-xl font-semibold tracking-tight">{t("authPage.login.title")}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{t("authPage.login.description")}</p>

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
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">{t("authPage.password")}</Label>
              </div>
              <Input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full h-10" size="lg">
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
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t("authPage.or")}</span>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {t("authPage.login.noAccount")}{" "}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("authPage.login.signUp")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
