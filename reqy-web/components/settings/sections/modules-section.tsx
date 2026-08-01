"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ModuleKind } from "@/lib/modules/types";
import {
  useAvailableModules,
  installModule,
  uninstallModule,
  setModuleEnabled,
  type AvailableModuleView,
} from "@/hooks/use-modules-store";

const KIND_LABEL: Record<ModuleKind, string> = {
  feature: "Fonctionnalité",
  content: "Contenu",
  integration: "Intégration",
};

export function ModulesSection() {
  const modules = useAvailableModules();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Modules</h2>
        <p className="text-sm text-muted-foreground">
          Installez et activez des modules optionnels. Les modules ne font pas partie du cœur
          générique de l'application et sont désactivés par défaut.
        </p>
      </div>
      {modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun module disponible.</p>
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
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{module.name}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {KIND_LABEL[module.kind]}
            </span>
            <span className="text-xs text-muted-foreground">v{module.version}</span>
          </div>
          {module.description ? (
            <p className="text-xs text-muted-foreground">{module.description}</p>
          ) : null}
          {module.author ? (
            <p className="text-xs text-muted-foreground/70">Par {module.author}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {module.installed ? (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch
                  checked={module.enabled}
                  onCheckedChange={(v) => setModuleEnabled(module.id, v)}
                  aria-label={`Activer ${module.name}`}
                />
                {module.enabled ? "Activé" : "Désactivé"}
              </label>
              <Button size="sm" variant="outline" onClick={() => uninstallModule(module.id)}>
                Désinstaller
              </Button>
            </>
          ) : (
            <Button size="sm" variant="default" onClick={() => installModule(module.id)}>
              Installer
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
