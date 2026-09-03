"use client";

import { useState, useEffect, useMemo } from "react";
import { Check, ChevronsUpDown, Eye, EyeOff, Plus, Settings2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useRequestStore, type EnvironmentVariable } from "@/hooks/use-request-store";
import { toast } from "@/hooks/use-toast";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

const envColors: Record<string, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
  pink: "bg-pink-500",
};

export function EnvironmentSelector() {
  const { t } = useTranslation();
  // Data slices (atomic selectors) — the dropdown re-renders only when the
  // environment list or the active id actually changes, not on every
  // unrelated store mutation.
  const environments = useRequestStore((s) => s.environments);
  const activeEnvironmentId = useRequestStore((s) => s.activeEnvironmentId);
  // Action refs are stable; group under useShallow.
  const { setActiveEnvironment, addEnvironment } = useRequestStore(
    useShallow((s) => ({
      setActiveEnvironment: s.setActiveEnvironment,
      addEnvironment: s.addEnvironment,
      updateEnvironment: s.updateEnvironment,
      deleteEnvironment: s.deleteEnvironment,
    })),
  );

  const [isManageOpen, setIsManageOpen] = useState(false);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);

  // Find active env — strict: no silent fallback to the first environment,
  // execution without an active environment is blocked downstream.
  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);

  const handleCreateNew = () => {
    const newId = addEnvironment({
      name: t("env.new"),
      color: "slate",
      variables: [{ key: "BASE_URL", value: "http://localhost:3000", enabled: true }],
    });
    toast({ title: "Environnement créé" });
    setEditingEnvId(newId);
    setIsManageOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("env.selectorAria")}
            title={activeEnv ? activeEnv.name : t("env.noEnvironment")}
            className="h-8 gap-2 border-dashed font-normal min-w-0"
          >
            <div
              className={cn(
                "size-2 rounded-full shrink-0",
                activeEnv
                  ? envColors[activeEnv.color] || "bg-muted-foreground"
                  : "border border-dashed border-muted-foreground bg-transparent",
              )}
            />
            {/* Compacte en conteneur étroit : pastille seule (le point sert d'icône). */}
            <span className="hidden @min-[48rem]:inline max-w-[130px] truncate">
              {activeEnv ? activeEnv.name : t("env.noEnvironment")}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("env.label")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {environments.map((env) => (
            <DropdownMenuItem
              key={env.id}
              onClick={() => {
                setActiveEnvironment(env.id);
                toast({ title: `Environnement ${env.name}` });
              }}
              className="flex items-center gap-2"
            >
              <div
                className={cn("size-2 rounded-full", envColors[env.color] || "bg-muted-foreground")}
              />
              <span className="flex-1 truncate">{env.name}</span>
              {activeEnvironmentId === env.id && <Check className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsManageOpen(true)} className="gap-2">
            <Settings2 className="size-3.5" />
            {t("env.manage")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateNew} className="gap-2">
            <Plus className="size-3.5" />
            {t("env.new")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ManageEnvironmentsDialog
        open={isManageOpen}
        onOpenChange={setIsManageOpen}
        initialEditingId={editingEnvId}
      />
    </>
  );
}

function ManageEnvironmentsDialog({
  open,
  onOpenChange,
  initialEditingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEditingId: string | null;
}) {
  const { t } = useTranslation();
  const environments = useRequestStore((s) => s.environments);
  const { addEnvironment, updateEnvironment, deleteEnvironment } = useRequestStore(
    useShallow((s) => ({
      addEnvironment: s.addEnvironment,
      updateEnvironment: s.updateEnvironment,
      deleteEnvironment: s.deleteEnvironment,
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEditingId || (environments.length > 0 ? environments[0].id : null),
  );
  const [envToDelete, setEnvToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!(open && initialEditingId && initialEditingId !== selectedId)) return;
    const resetTimeout = window.setTimeout(() => setSelectedId(initialEditingId), 0);
    return () => window.clearTimeout(resetTimeout);
  }, [open, initialEditingId, selectedId]);

  const selectedEnv = environments.find((e) => e.id === selectedId);

  // Suggest variable keys from OTHER environments for quick reuse
  const envKeySuggestions = useMemo((): AutocompleteGroup[] => {
    const otherKeys = new Set<string>();
    for (const env of environments) {
      if (env.id === selectedId) continue;
      for (const v of env.variables) {
        if (v.enabled && v.key.trim()) otherKeys.add(v.key.trim());
      }
    }
    if (otherKeys.size === 0) return [];
    return [
      {
        label: t("env.otherEnvKeys"),
        items: Array.from(otherKeys).map((key) => ({
          id: `ekey-${key}`,
          label: key,
          value: key,
          description: t("env.key"),
        })),
      },
    ];
  }, [environments, selectedId, t]);

  const envValSuggestions = useMemo((): AutocompleteGroup[] => {
    if (!selectedEnv) return [];
    const vars = selectedEnv.variables
      .filter((v) => v.enabled && v.key.trim())
      .map((v) => v.key.trim());
    // Also include env vars from themselves for {{VAR}} pattern
    const items = vars.map((key) => ({
      id: `eval-${key}`,
      label: `{{${key}}}`,
      value: `{{${key}}}`,
      description: t("env.variable"),
    }));
    if (items.length === 0) return [];
    return [{ label: t("env.variables"), items }];
  }, [selectedEnv, t]);

  const handleAddVar = () => {
    if (!selectedEnv) return;
    updateEnvironment(selectedEnv.id, {
      variables: [...selectedEnv.variables, { key: "", value: "", enabled: true }],
    });
  };

  const updateVar = (index: number, field: keyof EnvironmentVariable, value: string | boolean) => {
    if (!selectedEnv) return;
    const newVars = [...selectedEnv.variables];
    newVars[index] = { ...newVars[index], [field]: value };
    updateEnvironment(selectedEnv.id, { variables: newVars });
  };

  const removeVar = (index: number) => {
    if (!selectedEnv) return;
    const newVars = [...selectedEnv.variables];
    newVars.splice(index, 1);
    updateEnvironment(selectedEnv.id, { variables: newVars });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ maxWidth: "min(1400px, calc(100vw - 2rem))" }}
        className="h-[86vh] p-0 gap-0 flex overflow-hidden"
      >
        <DialogTitle className="sr-only">{t("env.manage")}</DialogTitle>
        {/* Left Sidebar */}
        <div className="w-1/3 border-r bg-muted/20 flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">{t("env.label")}</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                const newId = addEnvironment({
                  name: t("env.new"),
                  color: "slate",
                  variables: [],
                });
                setSelectedId(newId);
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {environments.map((env) => (
              <button
                key={env.id}
                onClick={() => setSelectedId(env.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors",
                  selectedId === env.id ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <div
                  className={cn(
                    "size-2 rounded-full shrink-0",
                    envColors[env.color] || "bg-muted-foreground",
                  )}
                />
                <span className="truncate flex-1">{env.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col bg-background">
          {selectedEnv ? (
            <>
              <div className="p-4 border-b flex items-center gap-4">
                <Input
                  value={selectedEnv.name}
                  onChange={(e) => updateEnvironment(selectedEnv.id, { name: e.target.value })}
                  className="max-w-[300px] font-semibold text-lg h-9 border-transparent hover:border-border focus-visible:border-border px-2"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 ml-auto mr-10 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setEnvToDelete(selectedEnv.id)}
                  disabled={environments.length <= 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{t("env.variables")}</h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddVar}
                      className="h-7 text-xs"
                    >
                      <Plus className="size-3 mr-1" /> {t("env.addVariable")}
                    </Button>
                  </div>

                  <div className="border rounded-md divide-y">
                    <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 p-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                      <div className="w-6" />
                      <div>VARIABLE</div>
                      <div>VALUE</div>
                      <div className="w-[72px]" />
                    </div>
                    {selectedEnv.variables.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        {t("env.noVariables")}
                      </div>
                    ) : (
                      selectedEnv.variables.map((v, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 p-2 items-center group"
                        >
                          <div className="w-6 flex justify-center">
                            <Checkbox
                              checked={v.enabled}
                              onCheckedChange={(c) => updateVar(i, "enabled", !!c)}
                            />
                          </div>
                          <AutocompleteInput
                            value={v.key}
                            onChange={(value) => updateVar(i, "key", value)}
                            placeholder="KEY"
                            className="h-8 font-mono text-xs"
                            suggestions={envKeySuggestions}
                            emptyMessage=""
                          />
                          <AutocompleteInput
                            value={v.value}
                            onChange={(value) => updateVar(i, "value", value)}
                            placeholder="value"
                            type={v.secret ? "password" : "text"}
                            className="h-8 font-mono text-xs"
                            suggestions={envValSuggestions}
                            emptyMessage=""
                          />
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => updateVar(i, "secret", !v.secret)}
                              className={cn(
                                "size-8 shrink-0",
                                v.secret ? "text-primary" : "text-muted-foreground",
                              )}
                              aria-label={t(
                                v.secret ? "env.showSecretValue" : "env.hideSecretValue",
                                {
                                  defaultValue: v.secret
                                    ? "Afficher la valeur"
                                    : "Masquer la valeur",
                                },
                              )}
                              title={t(v.secret ? "env.showSecretValue" : "env.hideSecretValue", {
                                defaultValue: v.secret ? "Afficher la valeur" : "Masquer la valeur",
                              })}
                            >
                              {v.secret ? (
                                <Eye className="size-3.5" />
                              ) : (
                                <EyeOff className="size-3.5" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeVar(i)}
                              className="size-8 opacity-0 group-hover:opacity-100 text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              {t("env.selectOne")}
            </div>
          )}
        </div>
      </DialogContent>

      <AlertDialog open={!!envToDelete} onOpenChange={(open) => !open && setEnvToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("env.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("env.deleteConfirm", {
                name: environments.find((e) => e.id === envToDelete)?.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEnvToDelete(null)}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (envToDelete) {
                  deleteEnvironment(envToDelete);
                  setSelectedId(environments.find((e) => e.id !== envToDelete)?.id || null);
                }
                setEnvToDelete(null);
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
