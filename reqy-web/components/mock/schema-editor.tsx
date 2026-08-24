"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Braces, Loader2, RefreshCw, Wand2 } from "lucide-react";
import type { BodySchema } from "@reqly/mock-engine";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { generateLocal } from "./local-engine";
import { parseSchemaText } from "./mock-utils";

const K = {
  schemaTab: "mocks.response.schema.title",
  preview: "mocks.response.schema.preview",
  regenerate: "mocks.response.schema.regenerate",
  invalid: "mocks.response.schema.invalid",
  format: "mocks.response.schema.format",
  chipEmail: "mocks.response.schema.chipEmail",
  chipUuid: "mocks.response.schema.chipUuid",
  chipDateTime: "mocks.response.schema.chipDateTime",
  chipPrice: "mocks.response.schema.chipPrice",
  chipObject: "mocks.response.schema.chipObject",
  chipArray: "mocks.response.schema.chipArray",
} as const;

const EMPTY_OBJECT_SCHEMA = '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}';

const CHIPS: Array<{ key: string; label: string; fragment: string; field: string }> = [
  {
    key: "email",
    label: K.chipEmail,
    fragment: '{ "type": "string", "format": "email" }',
    field: "email",
  },
  {
    key: "uuid",
    label: K.chipUuid,
    fragment: '{ "type": "string", "format": "uuid" }',
    field: "id",
  },
  {
    key: "date-time",
    label: K.chipDateTime,
    fragment: '{ "type": "string", "format": "date-time" }',
    field: "createdAt",
  },
  {
    key: "price",
    label: K.chipPrice,
    fragment: '{ "type": "number", "format": "price" }',
    field: "price",
  },
  {
    key: "object",
    label: K.chipObject,
    fragment: EMPTY_OBJECT_SCHEMA,
    field: "",
  },
  {
    key: "array",
    label: K.chipArray,
    fragment:
      '{\n  "type": "array",\n  "items": { "type": "string" },\n  "minItems": 1,\n  "maxItems": 5\n}',
    field: "",
  },
];

interface SchemaEditorProps {
  schema?: BodySchema;
  onChange: (schema: BodySchema | undefined) => void;
}

export function SchemaEditor({ schema, onChange }: SchemaEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState<string>(() =>
    schema ? JSON.stringify(schema, null, 2) : EMPTY_OBJECT_SCHEMA,
  );
  const lastEmitted = useRef<string>(schema ? JSON.stringify(schema, null, 2) : "");
  const [previewOn, setPreviewOn] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const incoming = schema ? JSON.stringify(schema, null, 2) : "";
    if (incoming && incoming !== lastEmitted.current) {
      setText(incoming);
      lastEmitted.current = incoming;
    }
  }, [schema]);

  const parsed = parseSchemaText(text);

  function commit(next: string) {
    setText(next);
    const result = parseSchemaText(next);
    if (result.valid) {
      lastEmitted.current = next;
      onChange(result.schema as BodySchema);
    }
  }

  async function regenerate() {
    try {
      if (!parsed.valid) {
        setPreviewError(t(K.invalid, { defaultValue: "JSON invalide" }));
        setPreview(null);
        return;
      }
      const generated = generateLocal(parsed.schema as BodySchema, Math.random);
      setPreview(JSON.stringify(generated, null, 2));
      setPreviewError(null);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreview(null);
    }
  }

  function insertFragment(fragment: string, fieldName: string) {
    try {
      const current: unknown = JSON.parse(text);
      if (
        current !== null &&
        typeof current === "object" &&
        !Array.isArray(current) &&
        (current as { type?: unknown }).type === "object" &&
        typeof (current as { properties?: unknown }).properties === "object" &&
        (current as { properties: Record<string, unknown> }).properties !== null &&
        fieldName
      ) {
        const holder = current as { properties: Record<string, unknown> };
        holder.properties[fieldName] = JSON.parse(fragment);
        commit(JSON.stringify(current, null, 2));
        return;
      }
    } catch {
      /* texte courant non exploitable → remplacement simple */
    }
    commit(fragment);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-schema`} className="text-xs text-muted-foreground">
          {t(K.schemaTab, { defaultValue: "Schéma (BodySchema JSON)" })}
        </Label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              if (parsed.valid) commit(JSON.stringify(parsed.schema, null, 2));
            }}
            disabled={!parsed.valid}
            aria-label={t(K.format, { defaultValue: "Formater" })}
            title={t(K.format, { defaultValue: "Formater (JSON.stringify)" })}
          >
            <Braces aria-hidden="true" className="size-3" />
            {t(K.format, { defaultValue: "Formater" })}
          </Button>
          <Switch
            id={`${id}-preview`}
            checked={previewOn}
            onCheckedChange={(on) => {
              setPreviewOn(on);
              if (on) void regenerate();
            }}
            aria-label={t(K.preview, { defaultValue: "Aperçu" })}
          />
          <Label htmlFor={`${id}-preview`} className="cursor-pointer text-xs">
            <Wand2 aria-hidden="true" className="mr-1 inline size-3 align-[-1px]" />
            {t(K.preview, { defaultValue: "Aperçu" })}
          </Label>
          {previewOn && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => void regenerate()}
              aria-label={t(K.regenerate, { defaultValue: "Régénérer" })}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <Textarea
        id={`${id}-schema`}
        value={text}
        onChange={(e) => commit(e.target.value)}
        rows={8}
        spellCheck={false}
        className={cn(
          "font-mono text-xs",
          !parsed.valid && "border-destructive focus-visible:ring-destructive/40",
        )}
        aria-invalid={!parsed.valid}
      />
      {!parsed.valid && (
        <p className="text-xs text-destructive">
          {t(K.invalid, { defaultValue: "JSON invalide" })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => insertFragment(chip.fragment, chip.field)}
            className="rounded-full border bg-accent/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            +{t(chip.label, { defaultValue: chip.key })}
          </button>
        ))}
      </div>
      {previewOn && (
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(K.preview, { defaultValue: "Aperçu" })}
          </p>
          {previewError ? (
            <p className="font-mono text-xs text-destructive">{previewError}</p>
          ) : (
            <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {preview ?? ""}
            </pre>
          )}
          {!preview && !previewError && (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
    </div>
  );
}
