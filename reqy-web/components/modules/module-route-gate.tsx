"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const enabled = useIsModuleEnabled(moduleId);
  const manifest = getModuleById(moduleId);

  if (enabled) return <>{children}</>;

  return (
    <main className="flex-1 overflow-auto p-6" data-testid="module-disabled">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {t("settings.modules.routeTitle", { name: manifest?.name ?? moduleId })}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.modules.notEnabled")}</p>
          </div>
          <Button asChild>
            <Link href="/settings/modules">{t("settings.modules.enableCta")}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
