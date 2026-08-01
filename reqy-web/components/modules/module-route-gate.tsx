"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIsModuleEnabled } from "@/hooks/use-modules-store";
import { getModuleById } from "@/lib/modules/registry";

/**
 * Gates a module's UI route behind its install/enabled state.
 *
 * The route file always exists (App Router requires physical route files at
 * build time), but we only render the module's content when the user has
 * installed + enabled it. Otherwise we show a clear notice pointing to the
 * Modules settings page — so a disabled module is never silently reachable.
 */
export function ModuleRouteGate({ moduleId, children }: { moduleId: string; children: ReactNode }) {
  const enabled = useIsModuleEnabled(moduleId);
  const manifest = getModuleById(moduleId);

  if (enabled) return <>{children}</>;

  return (
    <main className="flex-1 overflow-auto p-6" data-testid="module-disabled">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Module {manifest?.name ?? moduleId}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ce module n&apos;est pas activé. Activez-le depuis les Paramètres &gt; Modules pour
              l&apos;utiliser.
            </p>
          </div>
          <Button asChild>
            <Link href="/settings/modules">Activer le module</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
