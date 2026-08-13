"use client";
import { useState, useCallback, useMemo } from "react";
import { Send, Square, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import { useTranslation } from "react-i18next";

interface Props {
  endpoint: string;
  onEndpointChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running?: boolean;
  historyUrls?: string[];
  environmentVariableNames?: string[];
}

function validateGraphqlUrl(rawUrl: string, t: (key: string) => string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return t("graphql.address.urlRequired");
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return t("graphql.address.urlMustStartHttp");
  }
  try {
    new URL(trimmed);
  } catch {
    return t("graphql.address.invalidUrlFormat");
  }
  return null;
}

export function GraphqlAddressBar({
  endpoint,
  onEndpointChange,
  onSend,
  onStop,
  running,
  historyUrls,
  environmentVariableNames,
}: Props) {
  const { t } = useTranslation();
  const [urlError, setUrlError] = useState<string | null>(null);

  const gqlAutocompleteGroups = useMemo((): AutocompleteGroup[] => {
    const groups: AutocompleteGroup[] = [];

    // Environment variables
    const vars = environmentVariableNames?.filter(Boolean) ?? [];
    if (vars.length > 0) {
      groups.push({
        label: t("request.variables"),
        items: vars.map((name) => ({
          id: `gql-var-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
          description: t("graphql.address.variableDesc"),
        })),
      });
    }

    // GraphQL endpoint history
    const seen = new Set<string>();
    const historyItems: AutocompleteGroup["items"] = [];
    for (const u of historyUrls ?? []) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      historyItems.push({
        id: `gql-url-${u}`,
        label: u,
        value: u,
        description: t("graphql.address.historyDesc"),
      });
    }
    if (historyItems.length > 0) {
      groups.push({
        label: t("request.history"),
        items: historyItems.slice(0, 20),
      });
    }

    return groups;
  }, [environmentVariableNames, historyUrls, t]);

  const handleChange = useCallback(
    (value: string) => {
      onEndpointChange(value);
      if (urlError) {
        const err = validateGraphqlUrl(value, t);
        setUrlError(err);
      }
    },
    [onEndpointChange, urlError, t],
  );

  const handleSend = useCallback(() => {
    const err = validateGraphqlUrl(endpoint, t);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError(null);
    onSend();
  }, [endpoint, onSend, t]);

  return (
    <div className="border-b bg-card" data-testid="graphql-address-bar">
      <div className="flex items-center gap-2 p-3 pb-2">
        <span className="text-xs font-mono px-2 py-1 bg-primary/10 text-primary rounded">POST</span>
        <AutocompleteInput
          value={endpoint}
          onChange={handleChange}
          placeholder={t("graphql.address.placeholder")}
          className="flex-1 font-mono text-sm"
          data-testid="graphql-endpoint-input"
          suggestions={gqlAutocompleteGroups}
          emptyMessage=""
        />
        {running ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onStop}
            data-testid="graphql-stop-button"
          >
            <Square className="w-3 h-3 mr-1" /> {t("graphql.address.stop")}
          </Button>
        ) : (
          <Button size="sm" onClick={handleSend} data-testid="graphql-send-button">
            {running ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Send className="w-3 h-3 mr-1" />
            )}
            {t("graphql.address.send")}
          </Button>
        )}
      </div>
      {urlError && <p className="px-3 pb-2 text-sm font-medium text-destructive">{urlError}</p>}
    </div>
  );
}
