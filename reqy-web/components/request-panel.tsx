"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { FlaskConical, Code, Route, ListFilter, Tag } from "lucide-react";
import type { HttpMethod } from "@/lib/types";
import type { AutocompleteGroup } from "@/components/ui/autocomplete-input";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { SSEEventsModal } from "@/components/sse/sse-events-modal";

import { buildUrl } from "@/lib/request-executor";
import type { BodyType, AuthType, QueryParam, Header, PathParam } from "@/lib/request-executor";
import { syncPathParams } from "@/lib/path-params";
import type { Assertion } from "@/lib/test-runner/types";
import { AssertionEditor } from "@/components/assertion-editor";
import { ScriptEditor } from "@/components/script-editor";
import { KeyValueEditor } from "@/components/key-value-editor";
import { AuthSection } from "@/components/auth-section";
import { BodyEditor } from "@/components/body-editor";
import { RequestPanelUrlBar } from "@/components/request-panel-url-bar";
import { useTranslation } from "react-i18next";

interface RequestPanelProps {
  method: HttpMethod;
  url: string;
  queryParams: QueryParam[];
  pathParams: PathParam[];
  headers: Header[];
  body: string;
  bodyType: BodyType;
  authType: AuthType;
  authToken: string;
  runnerAssertions?: Assertion[];
  preRequestScript?: string;
  postResponseScript?: string;
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onQueryParamsChange: (queryParams: QueryParam[]) => void;
  onPathParamsChange: (pathParams: PathParam[]) => void;
  onHeadersChange: (headers: Header[]) => void;
  onBodyChange: (body: string) => void;
  onBodyTypeChange: (bodyType: BodyType) => void;
  onAuthChange: (type: AuthType, token: string) => void;
  onRunnerAssertionsChange?: (assertions: Assertion[]) => void;
  onPreRequestScriptChange?: (script: string) => void;
  onPostResponseScriptChange?: (script: string) => void;
  onSend: () => Promise<void>;
  onCancel?: () => void;
  followRedirects?: boolean;
  onFollowRedirectsChange?: (follow: boolean) => void;
  isLoading?: boolean;
  variableNames?: string[];
  /** History URLs for autocomplete (deduplicated most recent first). */
  historyUrls?: string[];
  /** Active environment variable names (enabled keys). */
  environmentVariableNames?: string[];
  /** Recent query param key suggestions from history. */
  queryParamKeySuggestions?: AutocompleteGroup[];
  /** Recent form-data key suggestions from history. */
  formDataKeySuggestions?: AutocompleteGroup[];
}

/** Common HTTP header names for autocomplete suggestions (static, module-scoped). */
const COMMON_HEADER_NAMES: string[] = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Disposition",
  "Content-Encoding",
  "Content-Language",
  "Content-Length",
  "Content-Type",
  "Cookie",
  "DNT",
  "ETag",
  "Expect",
  "Forwarded",
  "From",
  "Host",
  "If-Match",
  "If-Modified-Since",
  "If-None-Match",
  "If-Range",
  "If-Unmodified-Since",
  "Last-Modified",
  "Link",
  "Location",
  "Max-Forwards",
  "Origin",
  "Pragma",
  "Proxy-Authorization",
  "Range",
  "Referer",
  "Retry-After",
  "Server",
  "Set-Cookie",
  "TE",
  "Trailer",
  "Transfer-Encoding",
  "Upgrade",
  "User-Agent",
  "Vary",
  "Via",
  "WWW-Authenticate",
  "X-API-Key",
  "X-Content-Type-Options",
  "X-Forwarded-For",
  "X-Forwarded-Host",
  "X-Forwarded-Proto",
  "X-Frame-Options",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
  "X-Request-ID",
  "X-XSS-Protection",
];

export function RequestPanel({
  method,
  url,
  queryParams,
  pathParams = [],
  headers,
  body,
  bodyType,
  authType,
  authToken,
  runnerAssertions,
  preRequestScript,
  postResponseScript,
  onMethodChange,
  onUrlChange,
  onQueryParamsChange,
  onPathParamsChange,
  onHeadersChange,
  onBodyChange,
  onBodyTypeChange,
  onAuthChange,
  onRunnerAssertionsChange,
  onPreRequestScriptChange,
  onPostResponseScriptChange,
  onSend,
  onCancel,
  followRedirects,
  onFollowRedirectsChange,
  isLoading,
  variableNames,
  historyUrls: historyUrlsProp,
  environmentVariableNames,
  queryParamKeySuggestions,
  formDataKeySuggestions,
}: RequestPanelProps) {
  const { t } = useTranslation();
  const [sseModalOpen, setSseModalOpen] = useState(false);
  // Sync path params when URL changes - auto-add/remove :param patterns
  // Uses a ref to track the last synced URL so we don't loop.
  const lastSyncedUrlRef = useRef(url);
  useEffect(() => {
    if (url === lastSyncedUrlRef.current) return;
    lastSyncedUrlRef.current = url;
    const synced = syncPathParams(url, pathParams);
    onPathParamsChange(synced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Auto-parse query params from the URL and merge with existing ones.
  // Preserves existing user-added params that aren't in the URL.
  const lastParsedUrlRef = useRef(url);
  const queryParamsRef = useRef(queryParams);
  useEffect(() => {
    queryParamsRef.current = queryParams;
  }, [queryParams]);
  useEffect(() => {
    if (url === lastParsedUrlRef.current) return;
    lastParsedUrlRef.current = url;
    const qIndex = url.indexOf("?");
    if (qIndex === -1) return;
    const qs = url.slice(qIndex + 1).split("#")[0]; // strip hash
    if (!qs.trim()) return;

    // Parse ?key=value&... from the URL
    const urlParams = new URLSearchParams(qs);
    const current = queryParamsRef.current ?? [];
    const merged = new Map<string, QueryParam>();

    // Start with existing params (preserved if not overwritten by URL)
    for (const p of current) {
      merged.set(p.key, { ...p });
    }

    // URL params override (or add) existing ones, enabled by default
    for (const [key, value] of urlParams.entries()) {
      const existing = merged.get(key);
      if (existing && !existing.key.startsWith("__")) {
        // Update value but keep enabled/disabled state if user set it
        merged.set(key, { ...existing, value });
      } else {
        merged.set(key, { key, value, enabled: true });
      }
    }

    const mergedArr = Array.from(merged.values());

    // Only fire if something actually changed
    const currentJson = JSON.stringify(current);
    const mergedJson = JSON.stringify(mergedArr);
    if (currentJson !== mergedJson) {
      onQueryParamsChange(mergedArr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const urlAutocompleteGroups = useMemo((): AutocompleteGroup[] => {
    const groups: AutocompleteGroup[] = [];

    // Environment variables — show as {{var}}
    const envVars = environmentVariableNames?.filter(Boolean) ?? [];
    if (envVars.length > 0) {
      groups.push({
        label: t("request.variables"),
        items: envVars.map((name) => {
          const wrapped = `{{${name}}}`;
          return {
            id: `var-${name}`,
            label: wrapped,
            value: wrapped,
          };
        }),
      });
    }

    // Variable mappings (chained variables)
    const chainVars = variableNames?.filter(Boolean) ?? [];
    if (chainVars.length > 0) {
      groups.push({
        label: t("request.chaining"),
        items: chainVars.map((name) => {
          const wrapped = `{{${name}}}`;
          return {
            id: `chain-${name}`,
            label: wrapped,
            value: wrapped,
          };
        }),
      });
    }

    // URL history (deduplicated, most recent first)
    const seen = new Set<string>();
    const historyItems: AutocompleteGroup["items"] = [];
    for (const u of historyUrlsProp ?? []) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      historyItems.push({
        id: `url-${u}`,
        label: u,
        value: u,
      });
    }
    if (historyItems.length > 0) {
      groups.push({
        label: t("request.history"),
        items: historyItems.slice(0, 20), // cap at 20
      });
    }

    return groups;
  }, [environmentVariableNames, variableNames, historyUrlsProp, t]);

  // ── Autocomplete suggestions for KeyValueEditor ──────────────────────────
  const headerKeySuggestions = useMemo((): AutocompleteGroup[] => {
    return [
      {
        label: t("request.commonHeaders"),
        items: COMMON_HEADER_NAMES.map((name) => ({
          id: `hdr-${name}`,
          label: name,
          value: name,
        })),
      },
    ];
  }, [t]);

  const valueVarSuggestions = useMemo((): AutocompleteGroup[] => {
    const vars = environmentVariableNames?.filter(Boolean) ?? [];
    if (vars.length === 0) return [];
    return [
      {
        label: t("request.variables"),
        items: vars.map((name) => ({
          id: `vval-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
        })),
      },
    ];
  }, [environmentVariableNames, t]);

  const hasUrl = url.trim().length > 0;
  const hasPathVariables = pathParams.length > 0 || /(^|\/):[A-Za-z_][\w-]*/.test(url);

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
      {/* Request URL Section */}
      <div className="p-2 pb-1">
        <RequestPanelUrlBar
          method={method}
          url={url}
          queryParams={queryParams}
          headers={headers}
          body={body}
          bodyType={bodyType}
          authType={authType}
          authToken={authToken}
          onMethodChange={onMethodChange}
          onUrlChange={onUrlChange}
          onHeadersChange={onHeadersChange}
          onBodyChange={onBodyChange}
          onBodyTypeChange={onBodyTypeChange}
          onAuthChange={onAuthChange}
          variableNames={variableNames}
          onSend={onSend}
          isLoading={isLoading}
          urlAutocompleteGroups={urlAutocompleteGroups}
          hasUrl={hasUrl}
          onCancel={onCancel}
          followRedirects={followRedirects}
          onFollowRedirectsChange={onFollowRedirectsChange}
          onOpenSseStream={() => setSseModalOpen(true)}
        />
        <SSEEventsModal
          open={sseModalOpen}
          onOpenChange={setSseModalOpen}
          target={{
            url: buildUrl(url, queryParams, pathParams),
            headers: headers
              .filter((h) => h.enabled !== false && h.key.trim())
              .map((h) => ({ key: h.key.trim(), value: h.value })),
            authType,
            authToken,
          }}
        />
      </div>

      {/* Accordion — collapsed sections, expand to configure */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <Accordion type="multiple" className="space-y-1">
          {/* Path Variables - detected from :param patterns in the URL */}
          {hasPathVariables && (
            <AccordionItem value="path-vars" className="border border-border rounded-lg px-4 ">
              <AccordionTrigger className="section-trigger">
                <span className="flex items-center gap-2">
                  <Route className="size-3.5" />
                  {t("request.pathVariables")}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <KeyValueEditor
                  pairs={pathParams ?? []}
                  onChange={onPathParamsChange}
                  keyPlaceholder=":param"
                  valuePlaceholder={t("request.kvValue")}
                  addLabel={t("request.addPathVariable")}
                  emptyLabel={t("request.noPathParams")}
                  showToggle
                  valueSuggestions={valueVarSuggestions}
                />
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Query Params */}
          <AccordionItem value="query-params" className="border border-border rounded-lg px-4 ">
            <AccordionTrigger className="section-trigger">
              <span className="flex items-center gap-2">
                <ListFilter className="size-3.5" />
                {t("request.queryParams")}
                {queryParams.length > 0 && (
                  <span className="text-xs font-mono text-muted-foreground">
                    {queryParams.length}
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <KeyValueEditor
                pairs={queryParams}
                onChange={onQueryParamsChange}
                keyPlaceholder={t("request.kvKey")}
                valuePlaceholder={t("request.kvValue")}
                addLabel={t("request.addParameter")}
                emptyLabel={t("request.noParams")}
                showToggle
                keySuggestions={queryParamKeySuggestions}
                valueSuggestions={valueVarSuggestions}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Headers */}
          <AccordionItem value="headers" className="border border-border rounded-lg px-4 ">
            <AccordionTrigger className="section-trigger">
              <span className="flex items-center gap-2">
                <Tag className="size-3.5" />
                {t("request.headersLabel")}
                {headers.length > 0 && (
                  <span className="text-xs font-mono text-muted-foreground">{headers.length}</span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <KeyValueEditor
                pairs={headers}
                onChange={onHeadersChange}
                keyPlaceholder={t("request.kvKey")}
                valuePlaceholder={t("request.kvValue")}
                addLabel={t("request.addHeader")}
                emptyLabel={t("request.noHeaders")}
                showToggle
                keySuggestions={headerKeySuggestions}
                valueSuggestions={valueVarSuggestions}
              />
            </AccordionContent>
          </AccordionItem>

          <BodyEditor
            body={body}
            bodyType={bodyType}
            onBodyChange={onBodyChange}
            onBodyTypeChange={onBodyTypeChange}
            environmentVariableNames={environmentVariableNames}
            formDataKeySuggestions={formDataKeySuggestions}
          />

          <AuthSection
            authType={authType}
            authToken={authToken}
            onAuthChange={onAuthChange}
            environmentVariableNames={environmentVariableNames}
          />

          {/* Assertions (test-runner) */}
          <AccordionItem value="assertions-runner" className="border border-border rounded-lg px-4">
            <AccordionTrigger className="section-trigger">
              <span className="flex items-center gap-2">
                <FlaskConical className="size-3.5" />
                {t("assertion.title")}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <AssertionEditor
                assertions={runnerAssertions ?? []}
                onChange={onRunnerAssertionsChange ?? (() => {})}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Scripts */}
          <AccordionItem value="scripts" className="border border-border rounded-lg px-4">
            <AccordionTrigger className="section-trigger">
              <span className="flex items-center gap-2">
                <Code className="size-3.5" />
                Scripts
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ScriptEditor
                preRequestScript={preRequestScript}
                postResponseScript={postResponseScript}
                onPreChange={onPreRequestScriptChange ?? (() => {})}
                onPostChange={onPostResponseScriptChange ?? (() => {})}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
