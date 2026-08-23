"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/lib/session-store";
import { AuthBrandPanel } from "@/components/auth-brand-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, Mail, ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";

type Step = "form" | "verify";

export default function SignupPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const signup = useSessionStore((s) => s.signup);
  const verify = useSessionStore((s) => s.verify);
  const resendCode = useSessionStore((s) => s.resendCode);

  const [step, setStep] = useState<Step>(searchParams.has("verify") ? "verify" : "form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(searchParams.get("verify") || "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const codeInputs = useRef<(HTMLInputElement | null)[]>([]);

  const startCountdown = useCallback(() => {
    setCountdown(60);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // If we started on verify step (from ?verify=email), start countdown
  useEffect(() => {
    if (step === "verify" && email) {
      const timer = setTimeout(() => startCountdown(), 0);
      return () => clearTimeout(timer);
    }
  }, [step, email, startCountdown]);

  // Focus first code input when entering verify step
  useEffect(() => {
    if (step === "verify") {
      // Small delay to let the DOM render
      const timer = setTimeout(() => codeInputs.current[0]?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [step]);

  // ── Step 1: Signup form ───────────────────────────────────────────────

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("authPage.signup.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      await signup(email.trim(), password, name.trim() || undefined);
      setStep("verify");
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("authPage.signup.failed"));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verification code ─────────────────────────────────────────

  function handleCodeChange(index: number, value: string) {
    if (value.length > 1) {
      // Pasted code
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const next = [...code];
      for (let i = 0; i < 6; i++) {
        next[i] = digits[i] || "";
      }
      setCode(next);
      const focusIndex = Math.min(digits.length, 5);
      codeInputs.current[focusIndex]?.focus();
      return;
    }

    if (value && !/^\d$/.test(value)) return;

    const next = [...code];
    next[index] = value;
    setCode(next);

    // Auto-advance to next input
    if (value && index < 5) {
      codeInputs.current[index + 1]?.focus();
    }
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      codeInputs.current[index - 1]?.focus();
    }
    if (e.key === "Enter") {
      handleVerify();
    }
  }

  async function handleVerify() {
    const fullCode = code.join("");
    if (fullCode.length !== 6) {
      setError(t("authPage.verify.codeRequired"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await verify(email.trim(), fullCode);
      setVerifySuccess(true);
      // Redirect after a brief success animation
      setTimeout(() => router.push("/"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("authPage.verify.codeInvalid"));
      const e = err as Error & { attemptsRemaining?: number };
      if (typeof e.attemptsRemaining === "number") {
        setAttemptsLeft(e.attemptsRemaining);
      }
      // Clear code inputs on error
      setCode(["", "", "", "", "", ""]);
      codeInputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (countdown > 0) return;
    setError(null);
    setAttemptsLeft(null);
    try {
      await resendCode(email.trim());
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("authPage.verify.resendFailed"));
    }
  }

  // ── Render: Verify step ───────────────────────────────────────────────

  if (step === "verify") {
    if (verifySuccess) {
      return (
        <main className="grid min-h-screen lg:grid-cols-2">
          <AuthBrandPanel />
          <section className="flex items-center justify-center bg-background px-4 py-12 sm:px-8">
            <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="rounded-2xl border border-border bg-card p-8 shadow-xl shadow-black/[0.04] text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                  <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                </div>
                <h1 className="mb-1 text-xl font-semibold tracking-tight">
                  {t("authPage.verify.verifiedTitle")}
                </h1>
                <p className="text-sm text-muted-foreground">{t("authPage.verify.redirecting")}</p>
                <div className="mt-6 flex justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              </div>
            </div>
          </section>
        </main>
      );
    }

    return (
      <main className="grid min-h-screen lg:grid-cols-2">
        <AuthBrandPanel />
        <section className="flex items-center justify-center bg-background px-4 py-12 sm:px-8">
          <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-xl shadow-black/[0.04] sm:p-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>

              <h1 className="mb-1 text-xl font-semibold tracking-tight">
                {t("authPage.verify.title")}
              </h1>
              <p className="mb-1 text-sm text-muted-foreground">
                {t("authPage.verify.codeSentTo")}
              </p>
              <p className="mb-6 text-sm font-medium text-foreground">{email}</p>

              {/* Code inputs */}
              <div className="mb-6 flex justify-center gap-2">
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      codeInputs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(i, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(i, e)}
                    className={`h-12 w-10 rounded-lg border text-center text-lg font-semibold outline-none transition-all duration-150
                    ${
                      digit
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-background hover:border-muted-foreground/30"
                    }
                    focus:border-primary focus:ring-1 focus:ring-primary
                    ${loading ? "opacity-50 pointer-events-none" : ""}
                  `}
                    aria-label={t("authPage.verify.digitAria", { count: i + 1 })}
                    disabled={loading}
                  />
                ))}
              </div>

              {error && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-200 mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-left">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div>
                      <p className="text-sm text-destructive">{error}</p>
                      {attemptsLeft !== null && attemptsLeft > 0 && (
                        <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          ⏳ {attemptsLeft} tentative{attemptsLeft > 1 ? "s" : ""} restante
                          {attemptsLeft > 1 ? "s" : ""} — vérifiez l'email le plus récent reçu.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={handleVerify}
                disabled={loading || code.join("").length !== 6}
                className="w-full h-10"
                size="lg"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {t("authPage.verify.submitting")}
                  </span>
                ) : (
                  t("authPage.verify.submit")
                )}
              </Button>

              <div className="mt-5 flex flex-col items-center gap-2 text-sm text-muted-foreground">
                {countdown > 0 ? (
                  <p className="text-xs text-muted-foreground/70">
                    {t("authPage.verify.resendIn")}{" "}
                    <span className="font-mono font-medium text-foreground/60">{countdown}s</span>
                  </p>
                ) : (
                  <button
                    onClick={handleResend}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <Mail className="size-3.5" />
                    {t("authPage.verify.resend")}
                  </button>
                )}
              </div>

              <div className="mt-6 border-t border-border pt-4">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="size-3" />
                  {t("authPage.verify.backToLogin")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ── Render: Signup form ──────────────────────────────────────────────

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthBrandPanel />
      <section className="flex items-center justify-center bg-background px-4 py-12 sm:px-8">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/[0.04] sm:p-8">
            {/* Compact logo for mobile / small screens */}
            <div className="mb-6 flex items-center justify-center gap-2 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
                R
              </div>
              <span className="text-base font-semibold">Reqly</span>
            </div>

            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">
              {t("authPage.signup.title")}
            </h1>
            <p className="mb-7 text-sm text-muted-foreground">{t("authPage.signup.description")}</p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">{t("authPage.signup.name")}</Label>
                <Input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("authPage.signup.namePlaceholder")}
                  autoFocus
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-email">{t("authPage.email")}</Label>
                <Input
                  id="signup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("authPage.emailPlaceholder")}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="signup-password">{t("authPage.password")}</Label>
                  <span className="text-[10px] text-muted-foreground/60">
                    {t("authPage.signup.passwordHint")}
                  </span>
                </div>
                <Input
                  id="signup-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11"
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

              <Button type="submit" disabled={loading} className="h-11 w-full" size="lg">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {t("authPage.signup.submitting")}
                  </span>
                ) : (
                  t("authPage.signup.submit")
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t("authPage.signup.hasAccount")}{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                {t("authPage.signup.signIn")}
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
