"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, Copy, Plus, Trash2, X } from "lucide-react";
import type { MockResponse } from "@reqly/mock-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { statusBadgeClass } from "./mock-utils";
import { SchemaEditor } from "./schema-editor";
import { ResponseRulesEditor } from "./response-rules-editor";

const K = {
  statusCode: "mocks.response.statusCode",
  name: "mocks.response.name",
  namePh: "mocks.response.namePlaceholder",
  duplicate: "mocks.response.duplicate",
  remove: "mocks.response.remove",
  defaultResponse: "mocks.response.defaultResponse",
  defaultBadge: "mocks.response.defaultBadge",
  moveUp: "mocks.response.moveUp",
  moveDown: "mocks.response.moveDown",
  toggle: "mocks.response.toggle",
  bodyStatic: "mocks.body.static",
  bodySchema: "mocks.body.schema",
  headersTitle: "mocks.headers.title",
  headerKeyPh: "mocks.headers.keyPlaceholder",
  headerValuePh: "mocks.headers.valuePlaceholder",
  addHeader: "mocks.headers.add",
  removeHeader: "mocks.headers.remove",
} as const;

const STATIC_BODY_HINT =
  "{{request.path.id}} · {{request.query.x}} · {{request.header.h}} · {{request.body.a.b}} · {{uuid}} · {{int 1 10}} · {{faker.email}}";

interface ResponseCardProps {
  response: MockResponse;
  /** Shared radio group name across the route's responses. */
  groupName: string;
  isDefault: boolean;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Whether the card starts expanded (first response of the route). */
  defaultOpen?: boolean;
  onChange: (patch: Partial<MockResponse>) => void;
  onSetDefault: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

export function ResponseCard({
  response,
  groupName,
  isDefault,
  canRemove,
  canMoveUp,
  canMoveDown,
  defaultOpen = false,
  onChange,
  onSetDefault,
  onDuplicate,
  onRemove,
  onMove,
}: ResponseCardProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<"static" | "schema">(response.schema ? "schema" : "static");
  const [headerRows, setHeaderRows] = useState<Array<{ k: string; v: string }>>(() =>
    Object.entries(response.headers ?? {}).map(([k, v]) => ({ k, v })),
  );
  const lastHeadersModel = useRef(response.headers);
  const rules = response.rules ?? [];

  useEffect(() => {
    if (response.headers !== lastHeadersModel.current) {
      setHeaderRows(Object.entries(response.headers ?? {}).map(([k, v]) => ({ k, v })));
      lastHeadersModel.current = response.headers;
    }
  }, [response.headers]);

  function commitHeaderRows(rows: Array<{ k: string; v: string }>) {
    setHeaderRows(rows);
    const cleaned = rows.filter((row) => row.k.trim() !== "");
    const next = Object.fromEntries(cleaned.map((row) => [row.k.trim(), row.v]));
    lastHeadersModel.current = cleaned.length > 0 ? next : undefined;
    onChange({ headers: cleaned.length > 0 ? next : undefined });
  }

  return (
    <div className="bg-card/60 rounded-lg border transition-all duration-150">
      <div className="flex flex-wrap items-center gap-1.5 p-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t(K.toggle, { defaultValue: "Replier/Déplier la réponse" })}
          title={t(K.toggle, { defaultValue: "Replier/Déplier la réponse" })}
          className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
              statusBadgeClass(response.statusCode),
            )}
          >
            {response.statusCode}
          </span>
          <span className="min-w-0 truncate text-xs">
            {response.name || (
              <span className="text-muted-foreground">{t(K.namePh, { defaultValue: "ex. carte refusée" })}</span>
            )}
          </span>
          {isDefault && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {t(K.defaultBadge, { defaultValue: "défaut" })}
            </Badge>
          )}
          {rules.length > 0 && (
            <Badge variant="outline" className="shrink-0 gap-0.5 font-mono text-[10px]">
              <ArrowLeftRight aria-hidden="true" className="size-2.5" />
              {rules.length}
            </Badge>
          )}
        </button>
        <label
          className="text-muted-foreground hover:text-foreground flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px]"
          title={t(K.defaultResponse, { defaultValue: "Réponse par défaut" })}
        >
          <input
            type="radio"
            name={groupName}
            checked={isDefault}
            onChange={onSetDefault}
            className="accent-primary"
            aria-label={t(K.defaultResponse, { defaultValue: "Réponse par défaut" })}
          />
        </label>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            aria-label={t(K.moveUp, { defaultValue: "Monter" })}
            title={t(K.moveUp, { defaultValue: "Monter" })}
          >
            <ArrowUp aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            aria-label={t(K.moveDown, { defaultValue: "Descendre" })}
            title={t(K.moveDown, { defaultValue: "Descendre" })}
          >
            <ArrowDown aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onDuplicate}
            aria-label={t(K.duplicate, { defaultValue: "Dupliquer la réponse" })}
            title={t(K.duplicate, { defaultValue: "Dupliquer la réponse" })}
          >
            <Copy aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive size-6"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={t(K.remove, { defaultValue: "Supprimer la réponse" })}
            title={t(K.remove, { defaultValue: "Supprimer la réponse" })}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-2 border-t p-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex w-20 flex-col gap-1">
              <Label htmlFor={`${id}-status`} className="text-muted-foreground text-xs">
                {t(K.statusCode, { defaultValue: "Statut" })}
              </Label>
              <Input
                id={`${id}-status`}
                type="number"
                value={Number.isFinite(response.statusCode) ? response.statusCode : 200}
                onChange={(e) => onChange({ statusCode: Number(e.target.value) || 200 })}
                className="h-8 font-mono tabular-nums"
              />
            </div>
            <div className="flex min-w-36 flex-1 flex-col gap-1">
              <Label htmlFor={`${id}-name`} className="text-muted-foreground text-xs">
                {t(K.name, { defaultValue: "Nom (optionnel)" })}
              </Label>
              <Input
                id={`${id}-name`}
                value={response.name ?? ""}
                placeholder={t(K.namePh, { defaultValue: "ex. carte refusée" })}
                onChange={(e) => onChange({ name: e.target.value || undefined })}
                className="h-8"
              />
            </div>
          </div>

          <ResponseRulesEditor
            rules={rules}
            onChange={(next) => onChange({ rules: next.length > 0 ? next : undefined })}
          />

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v === "schema" ? "schema" : "static")}
            className="gap-2"
          >
            <TabsList className="h-7">
              <TabsTrigger value="static" className="text-xs">
                {t(K.bodyStatic, { defaultValue: "Statique" })}
              </TabsTrigger>
              <TabsTrigger value="schema" className="text-xs">
                {t(K.bodySchema, { defaultValue: "Schéma" })}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="static" className="flex flex-col gap-1">
              <Textarea
                value={response.body ?? ""}
                onChange={(e) => onChange({ body: e.target.value || undefined })}
                rows={6}
                spellCheck={false}
                className="font-mono text-xs"
                aria-label={t(K.bodyStatic, { defaultValue: "Statique" })}
              />
              <p className="text-muted-foreground/80 font-mono text-[11px]">{STATIC_BODY_HINT}</p>
            </TabsContent>
            <TabsContent value="schema">
              <SchemaEditor schema={response.schema} onChange={(schema) => onChange({ schema })} />
            </TabsContent>
          </Tabs>

          <div className="rounded-md border bg-background/40 p-2">
            <p className="mb-1.5 text-xs font-medium">
              {t(K.headersTitle, { defaultValue: "En-têtes" })}
            </p>
            <div className="flex flex-col gap-1.5">
              {headerRows.map((row, index) => (
                <div key={`${row.k}-${index}`} className="flex items-center gap-1.5">
                  <Input
                    value={row.k}
                    onChange={(e) =>
                      commitHeaderRows(
                        headerRows.map((r, i) => (i === index ? { ...r, k: e.target.value } : r)),
                      )
                    }
                    className="h-8 w-40 font-mono text-xs"
                    placeholder={t(K.headerKeyPh, { defaultValue: "Clé" })}
                    aria-label={t(K.headerKeyPh, { defaultValue: "Clé" })}
                  />
                  <Input
                    value={row.v}
                    onChange={(e) =>
                      commitHeaderRows(
                        headerRows.map((r, i) => (i === index ? { ...r, v: e.target.value } : r)),
                      )
                    }
                    className="h-8 flex-1 font-mono text-xs"
                    placeholder={t(K.headerValuePh, { defaultValue: "Valeur" })}
                    aria-label={t(K.headerValuePh, { defaultValue: "Valeur" })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7"
                    onClick={() => commitHeaderRows(headerRows.filter((_, i) => i !== index))}
                    aria-label={t(K.removeHeader, { defaultValue: "Supprimer l'en-tête" })}
                    title={t(K.removeHeader, { defaultValue: "Supprimer l'en-tête" })}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-fit text-xs"
                onClick={() =>
                  commitHeaderRows([
                    ...headerRows,
                    { k: `x-mock-header-${headerRows.length + 1}`, v: "" },
                  ])
                }
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {t(K.addHeader, { defaultValue: "Ajouter un en-tête" })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
