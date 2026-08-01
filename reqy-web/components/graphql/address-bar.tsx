"use client";
import { useState, useCallback, useMemo } from "react";
import { Send, Square, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";

interface Props {
  endpoint: string;
  onEndpointChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running?: boolean;
  historyUrls?: string[];
  environmentVariableNames?: string[];
}

function validateGraphqlUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "URL is required";
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return "URL must start with http:// or https://";
  }
  try {
    new URL(trimmed);
  } catch {
    return "Invalid URL format";
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
  const [urlError, setUrlError] = useState<string | null>(null);

  const gqlAutocompleteGroups = useMemo((): AutocompleteGroup[] => {
    const groups: AutocompleteGroup[] = [];

    // Environment variables
    const vars = environmentVariableNames?.filter(Boolean) ?? [];
    if (vars.length > 0) {
      groups.push({
        label: "Variables",
        items: vars.map((name) => ({
          id: `gql-var-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
          description: "variable",
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
        description: "historique",
      });
    }
    if (historyItems.length > 0) {
      groups.push({
        label: "Historique",
        items: historyItems.slice(0, 20),
      });
    }

    return groups;
  }, [environmentVariableNames, historyUrls]);

  const handleChange = useCallback(
    (value: string) => {
      onEndpointChange(value);
      if (urlError) {
        const err = validateGraphqlUrl(value);
        setUrlError(err);
      }
    },
    [onEndpointChange, urlError],
  );

  const handleSend = useCallback(() => {
    const err = validateGraphqlUrl(endpoint);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError(null);
    onSend();
  }, [endpoint, onSend]);

  return (
    <div className="border-b bg-card" data-testid="graphql-address-bar">
      <div className="flex items-center gap-2 p-3 pb-2">
        <span className="text-xs font-mono px-2 py-1 bg-primary/10 text-primary rounded">POST</span>
        <AutocompleteInput
          value={endpoint}
          onChange={handleChange}
          placeholder="https://api.example.com/graphql"
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
            <Square className="w-3 h-3 mr-1" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={handleSend} data-testid="graphql-send-button">
            {running ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Send className="w-3 h-3 mr-1" />
            )}
            Send
          </Button>
        )}
      </div>
      {urlError && <p className="px-3 pb-2 text-sm font-medium text-destructive">{urlError}</p>}
    </div>
  );
}
