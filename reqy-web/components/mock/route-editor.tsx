"use client";

import { useId, useState } from "react";
import { Ban, ChevronDown, Copy, Power, PowerOff, Plus, Trash2 } from "lucide-react";
import type { MockResponse, MockRoute } from "@reqly/mock-engine";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { BehaviorSection } from "./behavior-section";
import { ResponseCard } from "./response-card";
import { TraitIcons } from "./trait-icons";
import { HTTP_METHODS, slugify } from "./mock-utils";

const K = {
  method: "mocks.editor.method",
  path: "mocks.editor.path",
  pathPh: "mocks.editor.pathPlaceholder",
  advanced: "mocks.editor.advanced",
  routeId: "mocks.editor.routeId",
  responses: "mocks.editor.responses",
  addResponse: "mocks.editor.addResponse",
  duplicateRoute: "mocks.editor.duplicateRoute",
  deleteRoute: "mocks.editor.deleteRoute",
  enableRoute: "mocks.routes.enableRoute",
  disableRoute: "mocks.routes.disableRoute",
} as const;

interface RouteEditorProps {
  route: MockRoute;
  onChange: (patch: Partial<MockRoute>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function RouteEditor({ route, onChange, onDuplicate, onDelete }: RouteEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const responses = route.responses ?? [];
  const enabled = route.enabled !== false;

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

  function moveResponse(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= responses.length) return;
    const next = [...responses];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setResponses(next);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-3 py-2 backdrop-blur">
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
            size="sm"
            className="w-[5.75rem] font-mono text-xs"
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
          className="h-8 min-w-32 flex-1 font-mono text-xs font-semibold"
          aria-label={t(K.path, { defaultValue: "Chemin" })}
          spellCheck={false}
        />
        {!enabled && (
          <Badge variant="outline" className="text-muted-foreground shrink-0">
            <Ban aria-hidden="true" className="size-2.5" />
          </Badge>
        )}
        <Badge variant="outline" className="shrink-0 px-1 font-mono text-[10px]">
          {(route.responses ?? []).length}
        </Badge>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <TraitIcons route={route} />
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-7",
                  enabled ? "text-emerald-600 hover:text-emerald-600" : "text-muted-foreground",
                )}
                onClick={() => onChange({ enabled: !enabled })}
                aria-label={
                  enabled
                    ? t(K.disableRoute, { defaultValue: "Désactiver la route" })
                    : t(K.enableRoute, { defaultValue: "Activer la route" })
                }
                title={
                  enabled
                    ? t(K.disableRoute, { defaultValue: "Désactiver la route" })
                    : t(K.enableRoute, { defaultValue: "Activer la route" })
                }
              >
                {enabled ? (
                  <Power aria-hidden="true" className="size-3.5" />
                ) : (
                  <PowerOff aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {enabled
                ? t(K.disableRoute, { defaultValue: "Désactiver la route" })
                : t(K.enableRoute, { defaultValue: "Activer la route" })}
            </TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onDuplicate}
            aria-label={t(K.duplicateRoute, { defaultValue: "Dupliquer la route" })}
            title={t(K.duplicateRoute, { defaultValue: "Dupliquer la route" })}
          >
            <Copy aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive size-7"
            onClick={onDelete}
            aria-label={t(K.deleteRoute, { defaultValue: "Supprimer la route" })}
            title={t(K.deleteRoute, { defaultValue: "Supprimer la route" })}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="scrollbar-discreet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            aria-label={t(K.advanced, { defaultValue: "Options avancées de la route" })}
            title={t(K.advanced, { defaultValue: "Options avancées de la route" })}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3 transition-transform duration-150",
                advancedOpen && "rotate-180",
              )}
            />
            {t(K.routeId, { defaultValue: "ID de route" })}:{" "}
            <span className="font-mono">{route.id}</span>
          </Button>
          {advancedOpen && (
            <Input
              id={`${id}-route-id`}
              value={route.id}
              onChange={(e) => onChange({ id: e.target.value })}
              className="h-7 max-w-sm font-mono text-xs"
              aria-label={t(K.routeId, { defaultValue: "ID de route (unique)" })}
              spellCheck={false}
            />
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

        <div className="flex flex-col gap-2">
          {responses.map((response, index) => {
            const defaultId = route.defaultResponseId ?? responses[0]?.id;
            return (
              <ResponseCard
                key={response.id}
                response={response}
                groupName={`default-response-${route.id}`}
                isDefault={response.id === defaultId}
                defaultOpen={index === 0}
                canRemove={responses.length > 1}
                canMoveUp={index > 0}
                canMoveDown={index < responses.length - 1}
                onChange={(patch) => updateResponse(response.id, patch)}
                onSetDefault={() => onChange({ defaultResponseId: response.id })}
                onMove={(direction) => moveResponse(index, direction)}
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
    </div>
  );
}

function regenerateId(method: string, path: string): string {
  return slugify(String(method).toLowerCase(), path);
}
