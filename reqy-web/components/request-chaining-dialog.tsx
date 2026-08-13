"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HistoryItem, VariableMapping } from "@/hooks/use-request-store";
import { resolveMappingValue } from "@/lib/variable-mapping";
import { isSourcePathSyntaxValid } from "@/lib/variable-path";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface RequestChainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryItem[];
  variableMappings: VariableMapping[];
  onAddMapping: () => void;
  onUpdateMapping: (id: string, patch: Partial<VariableMapping>) => void;
  onRemoveMapping: (id: string) => void;
}

export function RequestChainingDialog({
  open,
  onOpenChange,
  history,
  variableMappings,
  onAddMapping,
  onUpdateMapping,
  onRemoveMapping,
}: RequestChainingDialogProps) {
  const { t } = useTranslation();
  const [pendingRemoveMappingId, setPendingRemoveMappingId] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[min(98vw,1400px)] h-[86vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 pr-12 border-b border-border">
          <DialogTitle>{t("chaining.title")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t("chaining.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t("chaining.mappings")}</p>
              <p className="text-sm text-muted-foreground">{t("chaining.mappingsHint")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("chaining.pathHint", {
                  path: <span className="font-mono">data.items[0].token</span>,
                  underscore: <span className="font-mono">_</span>,
                  dot: <span className="font-mono">.</span>,
                  dash: <span className="font-mono">-</span>,
                  brackets: <span className="font-mono">[]</span>,
                })}
              </p>
            </div>
            <Button size="sm" onClick={onAddMapping}>
              {t("chaining.addMapping")}
            </Button>
          </div>

          {variableMappings.length === 0 ? (
            <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              {t("chaining.noActiveMappings", {
                token: <span className="font-mono">{"{{token}}"}</span>,
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {variableMappings.map((mapping) => (
                <div key={mapping.id} className="rounded-lg border border-border bg-background p-4">
                  <div className="grid gap-4 xl:grid-cols-[2fr_1.4fr_1fr] items-end">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {t("chaining.sourceRequest")}
                      </p>
                      <Select
                        value={mapping.sourceRequestId}
                        onValueChange={(sourceRequestId) =>
                          onUpdateMapping(mapping.id, { sourceRequestId })
                        }
                      >
                        <SelectTrigger className="h-11 w-full min-w-0">
                          <SelectValue placeholder={t("chaining.selectRequest")} />
                        </SelectTrigger>
                        <SelectContent>
                          {history.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name ||
                                item.endpoint ||
                                item.url ||
                                t("chaining.untitledRequest")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {t("chaining.responsePath")}
                      </p>
                      <Input
                        value={mapping.sourcePath}
                        onChange={(e) =>
                          onUpdateMapping(mapping.id, { sourcePath: e.target.value })
                        }
                        placeholder="data.token"
                        className="h-11 w-full min-w-0"
                      />
                      {mapping.sourcePath.trim() &&
                        !isSourcePathSyntaxValid(mapping.sourcePath) && (
                          <p className="mt-2 text-xs text-destructive">
                            {t("chaining.invalidPathFormat")}
                          </p>
                        )}
                    </div>

                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {t("chaining.variableName")}
                      </p>
                      <Input
                        value={mapping.name}
                        onChange={(e) => onUpdateMapping(mapping.id, { name: e.target.value })}
                        placeholder="token"
                        className="h-11 w-full min-w-0"
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] items-center text-sm text-muted-foreground">
                    <div>
                      {t("chaining.preview")}{" "}
                      <span className="font-mono text-foreground">
                        {(() => {
                          const result = resolveMappingValue(mapping, history);
                          if (result.error)
                            return <span className="text-destructive">{result.error}</span>;
                          return result.value || "-";
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-start sm:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setPendingRemoveMappingId(mapping.id)}
                      >
                        {t("chaining.remove")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border">
          <div className="w-full flex justify-end p-4">
            <Button onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
          </div>
        </DialogFooter>
        <ConfirmDialog
          open={!!pendingRemoveMappingId}
          onOpenChange={(open) => {
            if (!open) setPendingRemoveMappingId(null);
          }}
          title={t("chaining.deleteMappingTitle")}
          description={t("chaining.deleteMappingDesc")}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            if (pendingRemoveMappingId) onRemoveMapping(pendingRemoveMappingId);
            setPendingRemoveMappingId(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
