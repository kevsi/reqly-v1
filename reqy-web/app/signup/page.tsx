"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSessionStore } from "@/lib/session-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, Mail, ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";

type Step = "form" | "verify";

export default function SignupPage() {
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
  const codeInputs = useRef<(HTMLInputElement | null)[]>([]);

  // If we started on verify step (from ?verify=email), start countdown
  useEffect(() => {
    if (step === "verify" && email) {
      startCountdown();
    }
  }, []);

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
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setLoading(true);
    try {
      await signup(email.trim(), password, name.trim() || undefined);
      setStep("verify");
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'inscription");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verification code ─────────────────────────────────────────

  function startCountdown() {
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
  }

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
      setError("Veuillez entrer le code à 6 chiffres.");
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
      setError(err instanceof Error ? err.message : "Code incorrect");
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
    try {
      await resendCode(email.trim());
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renvoyer le code");
    }
  }

  // ── Render: Verify step ───────────────────────────────────────────────

  if (step === "verify") {
    if (verifySuccess) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="rounded-xl border border-border bg-card p-8 shadow-sm text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h1 className="mb-1 text-xl font-semibold tracking-tight">Compte vérifié !</h1>
              <p className="text-sm text-muted-foreground">Redirection vers l&apos;application…</p>
              <div className="mt-6 flex justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>

            <h1 className="mb-1 text-xl font-semibold tracking-tight">Vérifiez votre email</h1>
            <p className="mb-1 text-sm text-muted-foreground">
              Un code à 6 chiffres a été envoyé à
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
                  aria-label={`Chiffre ${i + 1}`}
                  disabled={loading}
                />
              ))}
            </div>

            {error && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200 mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-left">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{error}</p>
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
                  Vérification…
                </span>
              ) : (
                "Vérifier mon compte"
              )}
            </Button>

            <div className="mt-5 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              {countdown > 0 ? (
                <p className="text-xs text-muted-foreground/70">
                  Renvoyer le code dans{" "}
                  <span className="font-mono font-medium text-foreground/60">{countdown}s</span>
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Mail className="size-3.5" />
                  Renvoyer le code
                </button>
              )}
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-3" />
                Retour à la connexion
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Render: Signup form ──────────────────────────────────────────────

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

          <h1 className="mb-1 text-xl font-semibold tracking-tight">Créer un compte</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Reqly synchronise vos collections, environnements et dossiers entre vos appareils.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-name">Nom (optionnel)</Label>
              <Input
                id="signup-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Votre nom"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="signup-password">Mot de passe</Label>
                <span className="text-[10px] text-muted-foreground/60">8 caractères min.</span>
              </div>
              <Input
                id="signup-password"
                type="password"
                required
                autoComplete="new-password"
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
                  Création du compte…
                </span>
              ) : (
                "Créer mon compte"
              )}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
