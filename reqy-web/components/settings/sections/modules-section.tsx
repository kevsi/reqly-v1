"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useAvailableModules,
  installModule,
  uninstallModule,
  setModuleEnabled,
  type AvailableModuleView,
} from "@/hooks/use-modules-store";
import { useTranslation } from "react-i18next";

export function ModulesSection() {
  const modules = useAvailableModules();
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{t("settings.modules.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.modules.description")}</p>
      </div>
      {modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.modules.empty")}</p>
      ) : (
        <div className="space-y-3">
          {modules.map((m) => (
            <ModuleCard key={m.id} module={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleCard({ module }: { module: AvailableModuleView }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{module.name}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t(`settings.modules.kinds.${module.kind}`)}
            </span>
            <span className="text-xs text-muted-foreground">v{module.version}</span>
          </div>
          {module.description ? (
            <p className="text-xs text-muted-foreground">{module.description}</p>
          ) : null}
          {module.author ? (
            <p className="text-xs text-muted-foreground/70">
              {t("settings.modules.byAuthor", { author: module.author })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {module.installed ? (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch
                  checked={module.enabled}
                  onCheckedChange={(v) => setModuleEnabled(module.id, v)}
                  aria-label={t("settings.modules.enableAria", { name: module.name })}
                />
                {module.enabled ? t("settings.modules.enabled") : t("settings.modules.disabled")}
              </label>
              <Button size="sm" variant="outline" onClick={() => uninstallModule(module.id)}>
                {t("settings.modules.uninstall")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="default" onClick={() => installModule(module.id)}>
              {t("settings.modules.install")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
