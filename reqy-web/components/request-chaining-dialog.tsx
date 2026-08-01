"use client";

import { useState } from "react";
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
  const [pendingRemoveMappingId, setPendingRemoveMappingId] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[min(98vw,1400px)] h-[86vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 pr-12 border-b border-border">
          <DialogTitle>Request chaining</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Inject values from previous responses into future requests using variables.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Mappings</p>
              <p className="text-sm text-muted-foreground">
                Use values from a prior response in later requests.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Use paths like <span className="font-mono">data.items[0].token</span>. Only
                alphanumeric characters, <span className="font-mono">_</span>,{" "}
                <span className="font-mono">.</span>, <span className="font-mono">-</span> and{" "}
                <span className="font-mono">[]</span> are allowed.
              </p>
            </div>
            <Button size="sm" onClick={onAddMapping}>
              Add mapping
            </Button>
          </div>

          {variableMappings.length === 0 ? (
            <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              No active mappings. Create a mapping and use it with{" "}
              <span className="font-mono">{"{{token}}"}</span> in URLs, headers, or body.
            </div>
          ) : (
            <div className="space-y-4">
              {variableMappings.map((mapping) => (
                <div key={mapping.id} className="rounded-lg border border-border bg-background p-4">
                  <div className="grid gap-4 xl:grid-cols-[2fr_1.4fr_1fr] items-end">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Source request
                      </p>
                      <Select
                        value={mapping.sourceRequestId}
                        onValueChange={(sourceRequestId) =>
                          onUpdateMapping(mapping.id, { sourceRequestId })
                        }
                      >
                        <SelectTrigger className="h-11 w-full min-w-0">
                          <SelectValue placeholder="Select request" />
                        </SelectTrigger>
                        <SelectContent>
                          {history.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name || item.endpoint || item.url || "Untitled request"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Response path
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
                            Invalid format: use data.items[0].token or data.user.id.
                          </p>
                        )}
                    </div>

                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Variable name
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
                      Preview:{" "}
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
                        Remove
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
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogFooter>
        <ConfirmDialog
          open={!!pendingRemoveMappingId}
          onOpenChange={(open) => {
            if (!open) setPendingRemoveMappingId(null);
          }}
          title="Supprimer ce mapping ?"
          description="Cette action est irréversible. Le mapping de variable sera définitivement supprimé."
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
          onConfirm={() => {
            if (pendingRemoveMappingId) onRemoveMapping(pendingRemoveMappingId);
            setPendingRemoveMappingId(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
