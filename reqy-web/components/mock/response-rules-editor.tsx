"use client";

import { Plus, X } from "lucide-react";
import type { MatchRule } from "@reqly/mock-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

const K = {
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
  conditional: "mocks.response.conditional",
} as const;

const RULE_TARGETS = ["query", "header", "body"] as const;
const RULE_OPS = ["equals", "exists", "missing", "contains", "regex"] as const;

interface ResponseRulesEditorProps {
  rules: MatchRule[];
  onChange: (rules: MatchRule[]) => void;
}

export function ResponseRulesEditor({ rules, onChange }: ResponseRulesEditorProps) {
  const { t } = useTranslation();

  function updateRule(index: number, patch: Partial<MatchRule>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="rounded-md border bg-background/40 p-2">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium">
          {t(K.rulesTitle, { defaultValue: "Règles" })}
        </p>
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
              className="text-muted-foreground hover:text-destructive size-7"
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
              aria-label={t(K.removeRule, { defaultValue: "Supprimer la règle" })}
              title={t(K.removeRule, { defaultValue: "Supprimer la règle" })}
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
          onClick={() => onChange([...rules, { target: "query", name: "", op: "equals", value: "" }])}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {t(K.addRule, { defaultValue: "Ajouter une règle" })}
        </Button>
      </div>
    </div>
  );
}
