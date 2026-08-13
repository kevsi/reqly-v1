"use client";

import { useState } from "react";
import { Copy, Check, Eye, EyeOff, Braces } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRequestStore } from "@/hooks/use-request-store";

import { interpolate } from "@/lib/utils";

export function VariablesPanel() {
  const { t } = useTranslation();
  const environments = useRequestStore((s) => s.environments);
  const activeEnvironmentId = useRequestStore((s) => s.activeEnvironmentId);
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
  const vars = activeEnv?.variables?.filter((v) => v.enabled && v.key.trim()) || [];

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const resolved = interpolate(previewUrl || "{{URL}}", vars);
  const hasUnresolved = previewUrl && resolved.includes("{{") && resolved.includes("}}");

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 gap-1.5 text-xs font-normal",
          vars.length > 0 && "border-success/30 text-success",
        )}
      >
        <Braces className="size-3.5" />
        {vars.length > 0
          ? t("variables.toggleCount", { count: vars.length })
          : t("variables.toggleDefault")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Braces className="size-4 text-primary" />
              {activeEnv ? (
                <>
                  <span>{activeEnv.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("variables.dialogCount", { count: vars.length })}
                  </span>
                </>
              ) : (
                t("variables.title")
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {activeEnv ? (
              <>
                {/* URL Preview tool */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t("variables.urlPreview")}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => setShowPreview(!showPreview)}
                    >
                      {showPreview ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                      {showPreview ? t("variables.hide") : t("variables.test")}
                    </Button>
                  </div>
                  {showPreview && (
                    <div className="space-y-2">
                      <Input
                        value={previewUrl}
                        onChange={(e) => setPreviewUrl(e.target.value)}
                        placeholder="{{BASE_URL}}/api/users"
                        className="h-8 font-mono text-xs"
                      />
                      <div
                        className={cn(
                          "rounded-md border px-3 py-2 text-xs font-mono break-all",
                          hasUnresolved
                            ? "border-destructive/30 bg-destructive/10 text-destructive"
                            : "border-success/30 bg-success/10 text-success",
                        )}
                      >
                        <span className="text-[10px] font-medium uppercase tracking-wider block mb-1">
                          {hasUnresolved ? t("variables.unresolved") : t("variables.resolved")}
                        </span>
                        {resolved}
                      </div>
                    </div>
                  )}
                </div>

                {/* Variable list */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 block">
                    {t("variables.available")}
                  </label>

                  {vars.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="rounded-full bg-muted/30 p-4 mb-3">
                        <Braces className="size-8 text-muted-foreground/30" />
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {t("variables.emptyTitle")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                        {t("variables.emptyDescription")}
                      </p>
                    </div>
                  ) : (
                    <div className="border rounded-lg divide-y overflow-hidden">
                      {/* Header */}
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 px-4 py-2 bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <span>{t("variables.columnVariable")}</span>
                        <span>{t("variables.columnValue")}</span>
                        <span className="w-7" />
                      </div>
                      {vars.map((v) => (
                        <div
                          key={v.key}
                          className="group grid grid-cols-[1fr_1fr_auto] gap-3 px-4 py-3 items-center hover:bg-accent/40 transition-colors"
                        >
                          <code className="text-xs font-semibold text-primary truncate">
                            {"{{"}
                            {v.key}
                            {"}}"}
                          </code>
                          <code className="text-xs text-muted-foreground truncate">
                            {v.value || (
                              <span className="italic opacity-50">{t("variables.emptyValue")}</span>
                            )}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(v.key)}
                            className="size-7 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t("variables.copyVarTitle", { key: `{{${v.key}}}` })}
                          >
                            {copiedKey === v.key ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Usage hint */}
                <div className="rounded-lg border bg-muted/50 p-4 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">{t("variables.howToUse")}</p>
                  <p>
                    {t("variables.howToUseType")}{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {"{{KEY}}"}
                    </code>{" "}
                    {t("variables.howToUseRest")}
                  </p>
                  <p>{t("variables.howToUseNote")}</p>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted/30 p-4 mb-3">
                  <Braces className="size-10 text-muted-foreground/30" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {t("variables.noActiveTitle")}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                  {t("variables.noActiveDescription")}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
