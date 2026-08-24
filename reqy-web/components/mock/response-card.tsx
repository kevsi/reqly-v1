"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import type { MatchRule, MockResponse } from "@reqly/mock-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";
import { SchemaEditor } from "./schema-editor";

const K = {
  statusCode: "mocks.response.statusCode",
  name: "mocks.response.name",
  namePh: "mocks.response.namePlaceholder",
  duplicate: "mocks.response.duplicate",
  remove: "mocks.response.remove",
  defaultResponse: "mocks.response.defaultResponse",
  conditional: "mocks.response.conditional",
  rulesTitle: "mocks.response.rules.title",
  addRule: "mocks.response.rules.add",
  ruleTarget: "mocks.response.rules.target",
  ruleName: "mocks.response.rules.name",
  ruleNamePh: "mocks.response.rules.namePlaceholder",
  ruleOp: "mocks.response.rules.op",
  ruleValue: "mocks.response.rules.value",
  ruleValuePh: "mocks.response.rules.valuePlaceholder",
  removeRule: "mocks.response.rules.remove",
  targetQuery: "mocks.response.rules.targetQuery",
  targetHeader: "mocks.response.rules.targetHeader",
  targetBody: "mocks.response.rules.targetBody",
  opEquals: "mocks.response.rules.opEquals",
  opExists: "mocks.response.rules.opExists",
  opMissing: "mocks.response.rules.opMissing",
  opContains: "mocks.response.rules.opContains",
  opRegex: "mocks.response.rules.opRegex",
  bodyStatic: "mocks.body.static",
  bodySchema: "mocks.body.schema",
  headersTitle: "mocks.headers.title",
  headerKeyPh: "mocks.headers.keyPlaceholder",
  headerValuePh: "mocks.headers.valuePlaceholder",
  addHeader: "mocks.headers.add",
  removeHeader: "mocks.headers.remove",
} as const;

const RULE_TARGETS = ["query", "header", "body"] as const;
const RULE_OPS = ["equals", "exists", "missing", "contains", "regex"] as const;

const STATIC_BODY_HINT =
  "{{request.path.id}} · {{request.query.x}} · {{request.header.h}} · {{request.body.a.b}} · {{uuid}} · {{int 1 10}} · {{faker.email}}";

interface ResponseCardProps {
  response: MockResponse;
  /** Shared radio group name across the route's responses. */
  groupName: string;
  isDefault: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<MockResponse>) => void;
  onSetDefault: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function ResponseCard({
  response,
  groupName,
  isDefault,
  canRemove,
  onChange,
  onSetDefault,
  onDuplicate,
  onRemove,
}: ResponseCardProps) {
  const { t } = useTranslation();
  const id = useId();
  const rules = response.rules ?? [];
  const [tab, setTab] = useState<"static" | "schema">(response.schema ? "schema" : "static");
  const [headerRows, setHeaderRows] = useState<Array<{ k: string; v: string }>>(() =>
    Object.entries(response.headers ?? {}).map(([k, v]) => ({ k, v })),
  );
  const lastHeadersModel = useRef(response.headers);
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

  function setRules(next: MatchRule[]) {
    onChange({ rules: next.length > 0 ? next : undefined });
  }

  function updateRule(index: number, patch: Partial<MatchRule>) {
    setRules(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-24 flex-col gap-1">
          <Label htmlFor={`${id}-status`} className="text-xs text-muted-foreground">
            {t(K.statusCode, { defaultValue: "Statut" })}
          </Label>
          <Input
            id={`${id}-status`}
            type="number"
            value={Number.isFinite(response.statusCode) ? response.statusCode : 200}
            onChange={(e) => onChange({ statusCode: Number(e.target.value) || 200 })}
            className="h-8 font-mono"
          />
        </div>
        <div className="flex min-w-36 flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
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
        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground">
          <input
            type="radio"
            name={groupName}
            checked={isDefault}
            onChange={onSetDefault}
            className="accent-primary"
            aria-label={t(K.defaultResponse, { defaultValue: "Réponse par défaut" })}
          />
          {t(K.defaultResponse, { defaultValue: "Réponse par défaut" })}
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onDuplicate}
            aria-label={t(K.duplicate, { defaultValue: "Dupliquer la réponse" })}
          >
            <Copy aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={t(K.remove, { defaultValue: "Supprimer la réponse" })}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-md border bg-background/40 p-2">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs font-medium">{t(K.rulesTitle, { defaultValue: "Règles" })}</p>
          {rules.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {t(K.conditional, { defaultValue: "conditionnelle" })}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {rules.map((rule, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              <Select
                value={rule.target}
                onValueChange={(v) => updateRule(index, { target: v as MatchRule["target"] })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-24"
                  aria-label={t(K.ruleTarget, { defaultValue: "Cible" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_TARGETS.map((target) => (
                    <SelectItem key={target} value={target}>
                      {t(
                        target === "query"
                          ? K.targetQuery
                          : target === "header"
                            ? K.targetHeader
                            : K.targetBody,
                        { defaultValue: target },
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={rule.name ?? ""}
                placeholder={
                  rule.target === "body"
                    ? t(K.ruleNamePh, { defaultValue: "user.address.city" })
                    : t(K.ruleNamePh, { defaultValue: "nom" })
                }
                onChange={(e) => updateRule(index, { name: e.target.value || undefined })}
                className="h-8 w-32 font-mono text-xs"
                aria-label={t(K.ruleName, { defaultValue: "Nom du paramètre" })}
              />
              <Select
                value={rule.op}
                onValueChange={(v) => updateRule(index, { op: v as MatchRule["op"] })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-28"
                  aria-label={t(K.ruleOp, { defaultValue: "Opérateur" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_OPS.map((op) => (
                    <SelectItem key={op} value={op}>
                      {t(
                        op === "equals"
                          ? K.opEquals
                          : op === "exists"
                            ? K.opExists
                            : op === "missing"
                              ? K.opMissing
                              : op === "contains"
                                ? K.opContains
                                : K.opRegex,
                        { defaultValue: op },
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rule.op !== "exists" && rule.op !== "missing" && (
                <Input
                  value={rule.value ?? ""}
                  placeholder={t(K.ruleValuePh, { defaultValue: "valeur" })}
                  onChange={(e) => updateRule(index, { value: e.target.value })}
                  className="h-8 min-w-28 flex-1 font-mono text-xs"
                  aria-label={t(K.ruleValue, { defaultValue: "Valeur attendue" })}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
                aria-label={t(K.removeRule, { defaultValue: "Supprimer la règle" })}
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
              setRules([...rules, { target: "query", name: "", op: "equals", value: "" }])
            }
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {t(K.addRule, { defaultValue: "Ajouter une règle" })}
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v === "schema" ? "schema" : "static")}
        className="mt-3 gap-2"
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
          <p className="font-mono text-[11px] text-muted-foreground/80">{STATIC_BODY_HINT}</p>
        </TabsContent>
        <TabsContent value="schema">
          <SchemaEditor schema={response.schema} onChange={(schema) => onChange({ schema })} />
        </TabsContent>
      </Tabs>

      <div className="mt-3 rounded-md border bg-background/40 p-2">
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
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => commitHeaderRows(headerRows.filter((_, i) => i !== index))}
                aria-label={t(K.removeHeader, { defaultValue: "Supprimer l'en-tête" })}
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
  );
}
