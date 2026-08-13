"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, Trash2, Code } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type { BodyType } from "@/lib/request-executor";
import { createJsonKeyDownHandler } from "@/lib/json-textarea-utils";

function parseFormBody(body: string): Array<{ key: string; value: string }> {
  if (!body) return [];
  return body
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return { key: decodeURIComponent(pair), value: "" };
      return {
        key: decodeURIComponent(pair.slice(0, eq)),
        value: decodeURIComponent(pair.slice(eq + 1)),
      };
    });
}

function serializeFormBody(pairs: Array<{ key: string; value: string }>): string {
  return pairs
    .filter((p) => p.key.trim())
    .map((p) => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`)
    .join("&");
}

interface BodyEditorProps {
  body: string;
  bodyType: BodyType;
  onBodyChange: (body: string) => void;
  onBodyTypeChange: (bodyType: BodyType) => void;
  /** Environment variable names for form-data value autocomplete. */
  environmentVariableNames?: string[];
  /** Recent form-data key suggestions from history. */
  formDataKeySuggestions?: AutocompleteGroup[];
}

export function BodyEditor({
  body,
  bodyType,
  onBodyChange,
  onBodyTypeChange,
  environmentVariableNames,
  formDataKeySuggestions,
}: BodyEditorProps) {
  const { t } = useTranslation();
  const [showRawBody, setShowRawBody] = useState(false);
  const [formPairs, setFormPairs] = useState<Array<{ key: string; value: string }>>(() =>
    parseFormBody(body),
  );

  const formValueSuggestions = useMemo((): AutocompleteGroup[] => {
    const vars = environmentVariableNames?.filter(Boolean) ?? [];
    if (vars.length === 0) return [];
    return [
      {
        label: t("body.variables"),
        items: vars.map((name) => ({
          id: `fval-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
          description: t("body.variable"),
        })),
      },
    ];
  }, [environmentVariableNames, t]);
  const lastBodyRef = useRef(body);
  useEffect(() => {
    if (lastBodyRef.current !== body) {
      lastBodyRef.current = body;
      setFormPairs(parseFormBody(body));
    }
  }, [body]);

  const updateFormPair = (index: number, field: "key" | "value", value: string) => {
    const newPairs = formPairs.map((p, i) => (i === index ? { ...p, [field]: value } : p));
    setFormPairs(newPairs);
    onBodyChange(serializeFormBody(newPairs));
  };

  const addFormPair = () => {
    setFormPairs([...formPairs, { key: "", value: "" }]);
  };

  const removeFormPair = (index: number) => {
    const newPairs = formPairs.filter((_, i) => i !== index);
    setFormPairs(newPairs);
    onBodyChange(serializeFormBody(newPairs));
  };

  const handleFormatJson = () => {
    if (bodyType !== "json" || !body.trim()) return;
    try {
      const parsed = JSON.parse(body);
      onBodyChange(JSON.stringify(parsed, null, 2));
    } catch {
      // invalid json, do nothing
    }
  };

  const isValidJson = useMemo(() => {
    if (!body.trim() || bodyType !== "json") return null;
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  }, [body, bodyType]);

  const bodyTypeLabels: Record<BodyType, string> = {
    json: t("body.typeJson"),
    "form-data": t("body.typeFormData"),
    "x-www-form": t("body.typeFormUrlEncoded"),
    raw: t("body.typeRaw"),
    binary: t("body.typeBinary"),
  };

  return (
    <AccordionItem value="body" className="border border-border rounded-lg px-4 ">
      <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-wider hover:no-underline [&[data-state=open]>svg]:rotate-180">
        <span className="flex items-center gap-2">
          {t("body.accordion")}
          <span className="text-[10px] font-mono font-normal text-muted-foreground/70">
            — {bodyTypeLabels[bodyType]}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex items-center gap-3 mb-3">
          <Select value={bodyType} onValueChange={(value) => onBodyTypeChange(value as BodyType)}>
            <SelectTrigger className="w-32 h-9 border-input bg-muted/20 text-xs font-medium transition-all duration-200 hover:border-muted-foreground/30">
              <SelectValue placeholder={t("body.typePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">{bodyTypeLabels.json}</SelectItem>
              <SelectItem value="form-data">{bodyTypeLabels["form-data"]}</SelectItem>
              <SelectItem value="x-www-form">{bodyTypeLabels["x-www-form"]}</SelectItem>
              <SelectItem value="raw">{bodyTypeLabels.raw}</SelectItem>
              <SelectItem value="binary">{bodyTypeLabels.binary}</SelectItem>
            </SelectContent>
          </Select>
          {bodyType === "json" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleFormatJson}
              className="h-9 gap-1.5 border-input bg-muted/20 text-xs font-medium transition-all duration-200 hover:border-muted-foreground/30"
              title={t("body.formatTitle")}
            >
              <Code className="size-3.5" />
              {t("body.format")}
            </Button>
          )}
          {bodyType === "json" && body.trim() && isValidJson !== null && (
            <span
              className={cn(
                "text-[11px] font-mono font-medium transition-colors duration-200",
                isValidJson ? "text-success" : "text-destructive",
              )}
            >
              {isValidJson ? t("body.valid") : t("body.invalid")}
            </span>
          )}
          {(bodyType === "form-data" || bodyType === "x-www-form") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRawBody(!showRawBody)}
              className="h-9 gap-1.5 text-xs font-medium transition-all duration-200 text-muted-foreground/70 hover:text-foreground"
            >
              <Code className="size-3.5" />
              {showRawBody ? t("body.parsed") : t("body.raw")}
            </Button>
          )}
        </div>
        {(bodyType === "form-data" || bodyType === "x-www-form") && !showRawBody ? (
          <div className="space-y-2">
            {formPairs.length === 0 && body.trim() === "" && (
              <div className="flex flex-col items-center justify-center py-6 text-xs text-muted-foreground/60">
                <span>{t("body.noFields")}</span>
              </div>
            )}
            {formPairs.map((pair, index) => (
              <div
                key={index}
                className="group/formpair flex items-center gap-2 rounded-lg transition-all duration-200 hover:bg-muted/20 -mx-1 px-1"
              >
                <AutocompleteInput
                  type="text"
                  value={pair.key}
                  onChange={(value) => updateFormPair(index, "key", value)}
                  placeholder={t("body.keyPlaceholder")}
                  className="flex-1 h-9 border-input bg-muted/20 text-sm transition-all duration-200 focus:bg-muted/40"
                  suggestions={formDataKeySuggestions}
                  emptyMessage=""
                />
                <span className="shrink-0 text-muted-foreground/30">=</span>
                <AutocompleteInput
                  type="text"
                  value={pair.value}
                  onChange={(value) => updateFormPair(index, "value", value)}
                  placeholder={t("body.valuePlaceholder")}
                  className="flex-1 h-9 border-input bg-muted/20 text-sm transition-all duration-200 focus:bg-muted/40"
                  suggestions={formValueSuggestions}
                  emptyMessage=""
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFormPair(index)}
                  className="shrink-0 size-8 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover/formpair:opacity-100 transition-all duration-200"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={addFormPair}
              className="w-full border-dashed border-muted-foreground/20 text-muted-foreground/70 hover:text-foreground hover:border-muted-foreground/40 transition-all duration-200 h-9 text-xs font-medium"
            >
              <Plus className="size-3.5 mr-1" />
              {t("body.addField")}
            </Button>
          </div>
        ) : (
          <div className="h-48 overflow-auto rounded-lg border border-border bg-code-bg flex flex-col transition-all duration-200 focus-within:border-primary/30 focus-within:shadow-[0_0_0_2px] focus-within:shadow-primary/10">
            <div className="flex items-center justify-between bg-code-header-bg px-4 py-1.5 border-b border-border/50">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive/70" />
                <span className="size-2.5 rounded-full bg-warning/70" />
                <span className="size-2.5 rounded-full bg-success/70" />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/50">
                {bodyType.toUpperCase()}
              </span>
            </div>
            <Textarea
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              onKeyDown={
                bodyType === "json" ? createJsonKeyDownHandler(body, onBodyChange) : undefined
              }
              className="h-full w-full rounded-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed text-code-text resize-none placeholder:text-muted-foreground/30"
              spellCheck={false}
              placeholder={
                bodyType === "json"
                  ? '{\n  "key": "value"\n}'
                  : bodyType === "binary"
                    ? t("body.binaryPlaceholder")
                    : t("body.bodyPlaceholder")
              }
              data-testid="request-body-textarea"
            />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
