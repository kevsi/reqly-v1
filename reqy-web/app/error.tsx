"use client";

/**
 * Root error boundary for the app directory.
 * Catches uncaught render errors and offers a reload action.
 */
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <AlertTriangle aria-hidden="true" className="size-10 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground">Une erreur est survenue</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Quelque chose s&apos;est mal passé lors du chargement de cette page. Vous pouvez réessayer
          ou revenir à l&apos;accueil.
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset} variant="default">
          Réessayer
        </Button>
        <Button onClick={() => (window.location.href = "/")} variant="outline">
          Accueil
        </Button>
      </div>
    </div>
  );
}
