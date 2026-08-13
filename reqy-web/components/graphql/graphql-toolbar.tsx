"use client";
import { RefreshCw, BookOpen, Loader2, ListTree, Braces, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PrettifyButton } from "./prettify-button";
import { useTranslation } from "react-i18next";

interface Props {
  onIntrospect: () => void;
  onToggleSchema: () => void;
  onPrettify: () => void;
  schemaOpen: boolean;
  introspecting: boolean;
  canPrettify: boolean;
  onToggleBuilder?: () => void;
  showBuilder?: boolean;
  builderAvailable?: boolean;
  // Variables & Headers toggles (new)
  onToggleVariables?: () => void;
  showVariables?: boolean;
  variablesCount?: number;
  variablesError?: boolean;
  onToggleHeaders?: () => void;
  showHeaders?: boolean;
  headersCount?: number;
  headersError?: boolean;
}

export function GraphqlToolbar({
  onIntrospect,
  onToggleSchema,
  onPrettify,
  schemaOpen,
  introspecting,
  canPrettify,
  onToggleBuilder,
  showBuilder,
  builderAvailable,
  onToggleVariables,
  showVariables,
  variablesCount = 0,
  variablesError = false,
  onToggleHeaders,
  showHeaders,
  headersCount = 0,
  headersError = false,
}: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-1.5 p-2 border-b bg-muted/20 flex-wrap"
      data-testid="graphql-toolbar"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={onIntrospect}
        disabled={introspecting}
        className="h-8 text-xs"
        data-testid="graphql-introspect-button"
      >
        {introspecting ? (
          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
        )}
        {t("graphql.toolbar.refreshSchema")}
      </Button>
      <Button
        variant={schemaOpen ? "default" : "outline"}
        size="sm"
        onClick={onToggleSchema}
        className="h-8 text-xs"
        data-testid="graphql-toggle-schema"
      >
        <BookOpen className="w-3.5 h-3.5 mr-1" />
        {schemaOpen ? t("graphql.toolbar.hide") : t("graphql.toolbar.show")}{" "}
        {t("graphql.toolbar.schema")}
      </Button>
      {onToggleBuilder && (
        <Button
          variant={showBuilder ? "default" : "outline"}
          size="sm"
          onClick={onToggleBuilder}
          disabled={!builderAvailable}
          className={cn("h-8 text-xs", !builderAvailable && "opacity-50")}
          data-testid="graphql-toggle-builder"
          title={
            builderAvailable
              ? t("graphql.toolbar.toggleBuilderTitle")
              : t("graphql.toolbar.refreshSchemaFirst")
          }
        >
          <ListTree className="w-3.5 h-3.5 mr-1" />
          {showBuilder ? t("graphql.toolbar.hide") : t("graphql.toolbar.show")}{" "}
          {t("graphql.toolbar.builder")}
        </Button>
      )}

      {/* Spacer pushes the right-side group to the end */}
      <div className="flex-1" />

      {onToggleVariables && (
        <Button
          variant={showVariables ? "default" : "outline"}
          size="sm"
          onClick={onToggleVariables}
          className={cn(
            "h-8 text-xs gap-1.5",
            variablesError && "border-destructive/50 text-destructive",
          )}
          data-testid="graphql-toggle-variables"
          title={
            variablesError
              ? t("graphql.toolbar.variablesJsonInvalid")
              : t("graphql.toolbar.toggleVariables")
          }
        >
          <Braces className="w-3.5 h-3.5" />
          {t("graphql.toolbar.variables")}
          {variablesCount > 0 && (
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
                showVariables ? "bg-primary-foreground text-primary" : "bg-primary/15 text-primary",
              )}
            >
              {variablesCount}
            </span>
          )}
        </Button>
      )}
      {onToggleHeaders && (
        <Button
          variant={showHeaders ? "default" : "outline"}
          size="sm"
          onClick={onToggleHeaders}
          className={cn(
            "h-8 text-xs gap-1.5",
            headersError && "border-destructive/50 text-destructive",
          )}
          data-testid="graphql-toggle-headers"
          title={
            headersError
              ? t("graphql.toolbar.headersJsonInvalid")
              : t("graphql.toolbar.toggleHeaders")
          }
        >
          <KeyRound className="w-3.5 h-3.5" />
          {t("graphql.toolbar.headers")}
          {headersCount > 0 && (
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
                showHeaders ? "bg-primary-foreground text-primary" : "bg-primary/15 text-primary",
              )}
            >
              {headersCount}
            </span>
          )}
        </Button>
      )}

      <PrettifyButton onClick={onPrettify} disabled={!canPrettify} />
    </div>
  );
}
