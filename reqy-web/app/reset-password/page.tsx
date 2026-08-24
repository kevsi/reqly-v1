"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authResetPassword, authVerifyResetCode } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldCheck,
  ArrowLeft,
  Hourglass,
} from "lucide-react";

type Step = "code" | "password";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get("email") ?? "";

  const [step, setStep] = useState<Step>("code");
  const [email, setEmail] = useState(prefillEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [codeInvalidated, setCodeInvalidated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function handleApiError(err: unknown) {
    setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    const e = err as Error & {
      status?: number;
      attemptsRemaining?: number;
      codeInvalidated?: boolean;
    };
    if (typeof e.attemptsRemaining === "number") {
      setAttemptsLeft(e.attemptsRemaining);
    }
    if (e.codeInvalidated || e.status === 429) {
      setCodeInvalidated(true);
    }
  }

  // ── Step 1: validate the code (not consumed server-side) ───────────────
  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAttemptsLeft(null);

    setLoading(true);
    try {
      await authVerifyResetCode(email.trim(), code);
      setStep("password");
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: perform the actual password change ─────────────────────────
  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    setLoading(true);
    try {
      await authResetPassword(email.trim(), code, newPassword);
      setSuccess(true);
    } catch (err) {
      handleApiError(err);
      // If the code got invalidated/expired between the two steps, go back.
      const e = err as Error & { status?: number; codeInvalidated?: boolean };
      if (e.codeInvalidated || e.status === 429 || e.status === 400) {
        setStep("code");
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                R
              </div>
              <span className="text-sm font-semibold">Reqly</span>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="size-6 text-green-600" />
              </div>
              <h1 className="mb-2 text-xl font-semibold tracking-tight">
                Mot de passe réinitialisé
              </h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Votre mot de passe a été mis à jour. Vous pouvez maintenant vous connecter.
              </p>
              <Button onClick={() => router.push("/login")} className="w-full h-10" size="lg">
                Se connecter
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              R
            </div>
            <span className="text-sm font-semibold">Reqly</span>
          </div>

          {/* ── Step indicator ─────────────────────────────────────────── */}
          <div className="mb-5 flex items-center gap-2" aria-hidden>
            {[1, 2].map((n) => (
              <div
                key={n}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  (step === "code" && n === 1) || (step === "password" && n <= 2)
                    ? "bg-primary"
                    : "bg-border"
                }`}
              />
            ))}
          </div>

          {step === "code" ? (
            <>
              <div className="mb-4 flex items-center gap-2">
                <KeyRound className="size-5 text-muted-foreground" />
                <h1 className="text-xl font-semibold tracking-tight">Vérification du code</h1>
              </div>
              <p className="mb-6 text-sm text-muted-foreground">
                Entrez le code à 6 chiffres reçu par email.
              </p>

              <form onSubmit={onVerifyCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vous@exemple.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-code">Code de vérification</Label>
                  <Input
                    id="reset-code"
                    type="text"
                    required
                    maxLength={6}
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    autoFocus
                    className="text-center text-lg tracking-[0.3em]"
                  />
                </div>

                {error && (
                  <ErrorBanner
                    error={error}
                    attemptsLeft={attemptsLeft}
                    codeInvalidated={codeInvalidated}
                    email={email}
                  />
                )}

                <Button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full h-10"
                  size="lg"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      Vérification...
                    </span>
                  ) : (
                    <>
                      <ShieldCheck className="size-4" />
                      Vérifier le code
                    </>
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <KeyRound className="size-5 text-muted-foreground" />
                <h1 className="text-xl font-semibold tracking-tight">Nouveau mot de passe</h1>
              </div>
              <p className="mb-6 text-sm text-muted-foreground">
                Code vérifié pour <span className="font-medium text-foreground">{email}</span>.
                Choisissez votre nouveau mot de passe.
              </p>

              <form onSubmit={onSubmitPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-password">Nouveau mot de passe</Label>
                  <Input
                    id="reset-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirm">Confirmer le mot de passe</Label>
                  <Input
                    id="reset-confirm"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <ErrorBanner
                    error={error}
                    attemptsLeft={attemptsLeft}
                    codeInvalidated={codeInvalidated}
                    email={email}
                  />
                )}

                <Button type="submit" disabled={loading} className="w-full h-10" size="lg">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      Réinitialisation...
                    </span>
                  ) : (
                    "Réinitialiser le mot de passe"
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("code");
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="size-3" />
                  Utiliser un autre code
                </button>
              </form>
            </>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Retour à la connexion
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

function ErrorBanner({
  error,
  attemptsLeft,
  codeInvalidated,
  email,
}: {
  error: string;
  attemptsLeft: number | null;
  codeInvalidated: boolean;
  email: string;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-top-2 duration-200 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-sm text-destructive">{error}</p>
          {attemptsLeft !== null && attemptsLeft > 0 && (
            <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Hourglass aria-hidden="true" className="mt-px size-3 shrink-0" />
              {attemptsLeft} tentative{attemptsLeft > 1 ? "s" : ""} restante
              {attemptsLeft > 1 ? "s" : ""} — vérifiez l&apos;email le plus récent reçu.
            </p>
          )}
          {codeInvalidated && (
            <Link
              href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Mail className="size-3.5" />
              Demander un nouveau code
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
