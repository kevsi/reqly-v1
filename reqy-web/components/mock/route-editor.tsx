"use client";

import { useId, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { MockResponse, MockRoute } from "@reqly/mock-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { BehaviorSection } from "./behavior-section";
import { ResponseCard } from "./response-card";
import { HTTP_METHODS, slugify } from "./mock-utils";

const K = {
  method: "mocks.editor.method",
  path: "mocks.editor.path",
  pathPh: "mocks.editor.pathPlaceholder",
  advanced: "mocks.editor.advanced",
  routeId: "mocks.editor.routeId",
  responses: "mocks.editor.responses",
  addResponse: "mocks.editor.addResponse",
} as const;

interface RouteEditorProps {
  route: MockRoute;
  onChange: (patch: Partial<MockRoute>) => void;
}

export function RouteEditor({ route, onChange }: RouteEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const responses = route.responses ?? [];

  function setResponses(next: MockResponse[]) {
    const patch: Partial<MockRoute> = { responses: next };
    if (route.defaultResponseId && !next.some((r) => r.id === route.defaultResponseId)) {
      patch.defaultResponseId = undefined;
    }
    onChange(patch);
  }

  function updateResponse(responseId: string, patch: Partial<MockResponse>) {
    setResponses(responses.map((r) => (r.id === responseId ? { ...r, ...patch } : r)));
  }

  function addResponse() {
    const newId = `${route.id}-r${responses.length + 1}-${Date.now().toString(36)}`;
    setResponses([
      ...responses,
      { id: newId, statusCode: 200, headers: { "content-type": "application/json" } },
    ]);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-28 flex-col gap-1">
          <Label htmlFor={`${id}-method`} className="text-xs text-muted-foreground">
            {t(K.method, { defaultValue: "Méthode" })}
          </Label>
          <Select
            value={String(route.method).toUpperCase()}
            onValueChange={(v) =>
              onChange({
                method: v as MockRoute["method"],
                id: regenerateId(v, route.path),
              })
            }
          >
            <SelectTrigger
              id={`${id}-method`}
              className="font-mono text-xs"
              aria-label={t(K.method, { defaultValue: "Méthode" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((method) => (
                <SelectItem key={method} value={method} className="font-mono text-xs">
                  {method}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-path`} className="text-xs text-muted-foreground">
            {t(K.path, { defaultValue: "Chemin" })}
          </Label>
          <Input
            id={`${id}-path`}
            value={route.path}
            placeholder={t(K.pathPh, { defaultValue: "/api/users/:id" })}
            onChange={(e) => onChange({ path: e.target.value })}
            onBlur={(e) =>
              onChange({
                path: e.target.value.startsWith("/") ? e.target.value : `/${e.target.value}`,
              })
            }
            className="font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <Badge variant="outline" className="max-w-40 truncate font-mono text-[10px]">
            {route.id}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            aria-label={t(K.advanced, { defaultValue: "Options avancées de la route" })}
          >
            <ChevronDown
              aria-hidden="true"
              className={`size-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </Button>
        </div>
        {advancedOpen && (
          <div className="flex w-full flex-col gap-1">
            <Label htmlFor={`${id}-route-id`} className="text-xs text-muted-foreground">
              {t(K.routeId, { defaultValue: "ID de route (unique)" })}
            </Label>
            <Input
              id={`${id}-route-id`}
              value={route.id}
              onChange={(e) => onChange({ id: e.target.value })}
              className="h-8 max-w-sm font-mono text-xs"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {t(K.responses, { defaultValue: "Réponses" })}
          <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
            {responses.length}
          </Badge>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addResponse}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {t(K.addResponse, { defaultValue: "Ajouter une réponse" })}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {responses.map((response, index) => {
          const defaultId = route.defaultResponseId ?? responses[0]?.id;
          return (
            <ResponseCard
              key={response.id}
              response={response}
              groupName={`default-response-${route.id}`}
              isDefault={response.id === defaultId}
              canRemove={responses.length > 1}
              onChange={(patch) => updateResponse(response.id, patch)}
              onSetDefault={() => onChange({ defaultResponseId: response.id })}
              onDuplicate={() => {
                const copy: MockResponse = {
                  ...structuredClone(response),
                  id: `${response.id}-copy-${index + 1}-${Date.now().toString(36)}`,
                  name: response.name ? `${response.name} (copie)` : undefined,
                };
                const next = [...responses];
                next.splice(index + 1, 0, copy);
                setResponses(next);
              }}
              onRemove={() => setResponses(responses.filter((r) => r.id !== response.id))}
            />
          );
        })}
      </div>

      <BehaviorSection route={route} onChange={onChange} />
    </div>
  );
}

function regenerateId(method: string, path: string): string {
  return slugify(String(method).toLowerCase(), path);
}
