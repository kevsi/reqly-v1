"use client";

import Link from "next/link";
import { Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/lib/session-store";

/**
 * Soft, non-blocking prompt shown on the Workspaces/sync area when the user
 * is not signed in. The app stays fully usable (local collections, and in dev
 * the service account), but this explains that sync is tied to an account —
 * matching how Postman/Insomnia surface "sign in to sync" without forcing it.
 * Renders nothing once the user is authenticated.
 */
export function SyncSignedOutBanner() {
  const status = useSessionStore((s) => s.status);
  if (status === "authenticated") return null;

  return (
    <div
      data-testid="sync-signed-out"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Cloud className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Connecte-toi pour synchroniser</p>
          <p className="text-xs text-muted-foreground">
            Tes espaces de travail sont liés à ton compte et synchronisés entre tes appareils.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/login">Se connecter</Link>
        </Button>
        <Button asChild>
          <Link href="/signup">Créer un compte</Link>
        </Button>
      </div>
    </div>
  );
}
