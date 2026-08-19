"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ListChecks, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { EnvironmentSelector } from "@/components/environment-selector";
import type { Collection } from "@/hooks/request-types";

interface RunnerHeaderProps {
  selectedId: string;
  collections: Collection[];
  onSelectChange: (id: string) => void;
  disabled?: boolean;
  hasReport?: boolean;
  onViewReport?: () => void;
}

export function RunnerHeader({
  selectedId,
  collections,
  onSelectChange,
  disabled,
  hasReport,
  onViewReport,
}: RunnerHeaderProps) {
  const { t } = useTranslation();
  const selected = collections.find((c) => c.id === selectedId) ?? collections[0] ?? null;

  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
      <div>
        <div className="flex items-center gap-2">
          <Select value={selectedId} onValueChange={onSelectChange} disabled={disabled}>
            <SelectTrigger className="w-64 font-semibold text-base h-9 bg-card">
              <SelectValue placeholder={t("runner.selectCollection")} />
            </SelectTrigger>
            <SelectContent>
              {collections.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("runner.noCollections")}
                </div>
              )}
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-3.5 text-amber-500" />
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({c.requests?.length ?? 0})
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="font-mono text-xs">
            <ListChecks className="size-3 mr-1" />
            Runner
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{t("runner.description")}</p>
      </div>

      <div className="flex items-center gap-3">
        <EnvironmentSelector />
        {hasReport && onViewReport && (
          <button
            type="button"
            onClick={onViewReport}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors"
          >
            <ListChecks className="size-3.5 text-primary" />
            Voir le résultat
          </button>
        )}
      </div>
    </header>
  );
}
