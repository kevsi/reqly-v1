"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authForgotPassword } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, CheckCircle2, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authForgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
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
              <h1 className="mb-2 text-xl font-semibold tracking-tight">Email envoyé</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Si un compte existe avec <strong>{email}</strong>, vous recevrez un code de
                réinitialisation. Vérifiez votre boîte de réception.
              </p>
              <Link href={`/reset-password?email=${encodeURIComponent(email)}`} className="w-full">
                <Button className="w-full h-10" size="lg">
                  Entrer le code de réinitialisation
                </Button>
              </Link>
              <p className="mt-4 text-sm text-muted-foreground">
                <Link
                  href="/login"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Retour à la connexion
                </Link>
              </p>
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

          <div className="mb-4 flex items-center gap-2">
            <Mail className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight">Mot de passe oublié</h1>
          </div>
          <p className="mb-6 text-sm text-muted-foreground">
            Entrez votre adresse email et nous vous enverrons un code pour réinitialiser votre mot
            de passe.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                autoFocus
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
                  Envoi en cours...
                </span>
              ) : (
                "Envoyer le code"
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
