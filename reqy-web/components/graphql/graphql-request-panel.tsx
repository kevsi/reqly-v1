"use client";

import { useMemo, useState } from "react";
import { useRequestStore } from "@/hooks/use-request-store";
import { GraphqlAddressBar } from "./address-bar";
import { GraphqlToolbar } from "./graphql-toolbar";
import { GraphqlQueryEditor } from "./graphql-query-editor";
import { GraphqlQueryBuilder, type OperationType, type SchemaData } from "./graphql-query-builder";
import { VariablesPanel } from "./variables-panel";
import { HeadersPanel } from "./headers-panel";
import { CollapsibleSection } from "./collapsible-section";
import type { GraphqlTab } from "@/lib/types";

interface Props {
  tab: GraphqlTab;
  onUpdate: (patch: Partial<GraphqlTab>) => void;
  onSend: () => void;
  onStop: () => void;
  onIntrospect: () => void;
  onPrettify: () => void;
  onToggleSchema: () => void;
  schemaOpen: boolean;
  running: boolean;
}

function countJsonKeys(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}") return 0;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed).length;
    }
    if (Array.isArray(parsed)) return parsed.length;
    return 1;
  } catch {
    return 0;
  }
}

function isValidJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}") return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function GraphqlRequestPanel({
  tab,
  onUpdate,
  onSend,
  onStop,
  onIntrospect,
  onPrettify,
  onToggleSchema,
  schemaOpen,
  running,
}: Props) {
  const history = useRequestStore((s) => s.history);
  const environments = useRequestStore((s) => s.environments);
  const activeEnvironmentId = useRequestStore((s) => s.activeEnvironmentId);

  const gqlHistoryUrls = useMemo(
    () => history.map((h) => h.url).filter(Boolean) as string[],
    [history],
  );
  const gqlEnvVarNames = useMemo(() => {
    const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
    return (activeEnv?.variables ?? [])
      .filter((v) => v.enabled && v.key.trim())
      .map((v) => v.key.trim());
  }, [environments, activeEnvironmentId]);

  const [showBuilder, setShowBuilder] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [operationType, setOperationType] = useState<OperationType>("query");
  const schemaData = (tab.schema as SchemaData | null) ?? null;

  const variablesCount = useMemo(() => countJsonKeys(tab.variables), [tab.variables]);
  const headersCount = useMemo(() => countJsonKeys(tab.headers), [tab.headers]);
  const variablesValid = useMemo(() => isValidJson(tab.variables), [tab.variables]);
  const headersValid = useMemo(() => isValidJson(tab.headers), [tab.headers]);

  // When both Variables and Headers are open, place them side-by-side to save
  // vertical space and keep the editor reachable.
  const sideBySide = showVariables && showHeaders;

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="graphql-request-panel">
      <GraphqlAddressBar
        endpoint={tab.endpoint}
        onEndpointChange={(v) => onUpdate({ endpoint: v })}
        onSend={onSend}
        onStop={onStop}
        running={running}
        historyUrls={gqlHistoryUrls}
        environmentVariableNames={gqlEnvVarNames}
      />
      <GraphqlToolbar
        onIntrospect={onIntrospect}
        onToggleSchema={onToggleSchema}
        onPrettify={onPrettify}
        schemaOpen={schemaOpen}
        introspecting={tab.schemaLoading ?? false}
        canPrettify={!!tab.query.trim()}
        onToggleBuilder={() => setShowBuilder((s) => !s)}
        showBuilder={showBuilder}
        builderAvailable={!!schemaData}
        onToggleVariables={() => setShowVariables((s) => !s)}
        showVariables={showVariables}
        variablesCount={variablesCount}
        variablesError={!variablesValid}
        onToggleHeaders={() => setShowHeaders((s) => !s)}
        showHeaders={showHeaders}
        headersCount={headersCount}
        headersError={!headersValid}
      />

      {/*
        Scrollable area for Variables / Headers / Builder. Each section has
        its own max-h + scroll so the editor below is never pushed off-screen.
      */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sideBySide ? (
          <div className="grid grid-cols-2 divide-x divide-border">
            {showVariables && (
              <CollapsibleSection
                title="Variables"
                count={variablesCount}
                error={!variablesValid}
                onClose={() => setShowVariables(false)}
                bodyMaxHeightClass="max-h-[40vh]"
              >
                <VariablesPanel
                  value={tab.variables}
                  onChange={(v) => onUpdate({ variables: v })}
                  defaultOpen
                  hideHeader
                  environmentVariableNames={gqlEnvVarNames}
                />
              </CollapsibleSection>
            )}
            {showHeaders && (
              <CollapsibleSection
                title="Headers"
                count={headersCount}
                error={!headersValid}
                onClose={() => setShowHeaders(false)}
                bodyMaxHeightClass="max-h-[40vh]"
                className="border-l-0"
              >
                <HeadersPanel
                  value={tab.headers}
                  onChange={(h) => onUpdate({ headers: h })}
                  defaultOpen
                  hideHeader
                />
              </CollapsibleSection>
            )}
          </div>
        ) : (
          <>
            {showVariables && (
              <CollapsibleSection
                title="Variables"
                count={variablesCount}
                error={!variablesValid}
                onClose={() => setShowVariables(false)}
                bodyMaxHeightClass="max-h-[40vh]"
              >
                <VariablesPanel
                  value={tab.variables}
                  onChange={(v) => onUpdate({ variables: v })}
                  defaultOpen
                  hideHeader
                  environmentVariableNames={gqlEnvVarNames}
                />
              </CollapsibleSection>
            )}
            {showHeaders && (
              <CollapsibleSection
                title="Headers"
                count={headersCount}
                error={!headersValid}
                onClose={() => setShowHeaders(false)}
                bodyMaxHeightClass="max-h-[40vh]"
              >
                <HeadersPanel
                  value={tab.headers}
                  onChange={(h) => onUpdate({ headers: h })}
                  defaultOpen
                  hideHeader
                />
              </CollapsibleSection>
            )}
          </>
        )}

        {showBuilder && schemaData && (
          <CollapsibleSection
            title="Visual Builder"
            onClose={() => setShowBuilder(false)}
            defaultOpen
            bodyMaxHeightClass="max-h-[50vh]"
            hint="Check fields to build a query"
          >
            <GraphqlQueryBuilder
              schema={schemaData}
              operationType={operationType}
              onOperationTypeChange={setOperationType}
              onQueryChange={(q) => onUpdate({ query: q })}
              operationName={tab.operationName ?? "Generated"}
            />
          </CollapsibleSection>
        )}

        {/*
          Editor always has a minimum visible height so it never disappears
          even when every other panel is expanded.
        */}
        <div className="min-h-[200px] flex flex-col" data-testid="graphql-editor-wrap">
          <GraphqlQueryEditor
            value={tab.query}
            onChange={(q) => onUpdate({ query: q })}
            schema={tab.schema}
          />
        </div>
      </div>
    </div>
  );
}
