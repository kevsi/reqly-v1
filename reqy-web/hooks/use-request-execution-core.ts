"use client";

import { useCallback, useMemo, useRef } from "react";
import { interpolate, replaceLocalhostPort, hasUnresolvedPlaceholders } from "@/lib/utils";
import { runScript } from "@/lib/test-runner/scripts";
import type { RunnerContext } from "@/lib/test-runner/types";
import { toast } from "@/hooks/use-toast";
import { headersArrayToRecord, recordToHeaderArray } from "@/lib/request-tab-utils";
import { useRequestStore, type HistoryItem, type RequestItem } from "@/hooks/use-request-store";
import { type HttpMethod, type RequestTab, executeRequest } from "@/lib/request-executor";
import { computeDynamicVars, getUnresolvedWarnings } from "@/lib/variable-mapping";
import type { RequestTabsState } from "@/hooks/use-request-tabs-state";
import type { PendingCollectionRequest } from "@/lib/request-bridge";
import { isTauriInvokeError } from "@/lib/tauri";
import { useTranslation } from "react-i18next";

export function useRequestExecutionCore(state: RequestTabsState) {
  const { nativeMode, setLoadingCount, updateTab } = state;
  const { t } = useTranslation();

  // Abort handle for the in-flight request so the UI can offer a Cancel
  // button while a request is running.
  const abortRef = useRef<AbortController | null>(null);

  const {
    environments,
    activeEnvironmentId,
    projects,
    selectedProjectId,
    history,
    addHistoryAndNotify,
    variableMappings,
    setCurrentRequest,
    setLastResponse,
    activeWorkspaceId,
  } = useRequestStore();

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const activeProjectPort = activeProject?.port ?? 3000;
  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
  const envVars = useMemo(() => activeEnv?.variables || [], [activeEnv]);

  const allVars = useMemo(
    () => [...envVars, ...computeDynamicVars(variableMappings, history)],
    [envVars, variableMappings, history],
  );

  const notifyUnresolvedVariables = useCallback(() => {
    const warnings = getUnresolvedWarnings(variableMappings, history);
    if (warnings.length === 0) return;
    const preview = warnings
      .slice(0, 3)
      .map((w) => `{{${w.name}}}: ${w.error}`)
      .join(" · ");
    const suffix = warnings.length > 3 ? ` (+${warnings.length - 3} autres)` : "";
    toast({
      title: t("request.unresolvedVariables"),
      description: `${preview}${suffix}`,
      variant: "destructive",
    });
  }, [variableMappings, history, t]);

  const buildTabFromRequest = useCallback(
    (request: RequestItem | HistoryItem | PendingCollectionRequest): Partial<RequestTab> => ({
      name: request.name,
      method: request.method as HttpMethod,
      url: activeProject ? replaceLocalhostPort(request.url, activeProjectPort) : request.url,
      endpoint: request.endpoint,
      headers: recordToHeaderArray(request.headers),
      queryParams: request.queryParams ?? [],
      pathParams: (request as RequestItem).pathParams ?? [],
      body: request.body ?? "",
      bodyType: (request as RequestItem).bodyType ?? "json",
      authType: (request as RequestItem).authType ?? "none",
      authToken: (request as RequestItem).authToken ?? "",
      assertions: (request as RequestItem).assertions ?? [],
      runnerAssertions: (request as RequestItem).runnerAssertions ?? [],
      preRequestScript: (request as RequestItem).preRequestScript ?? "",
      postResponseScript: (request as RequestItem).postResponseScript ?? "",
      protocol: (request as RequestItem).protocol,
      graphql: (request as RequestItem).graphql,
      datasetKey: (request as RequestItem).datasetKey,
      hasResponse: false,
      isSaved: true,
      savedRequestId:
        "id" in request && typeof (request as { id?: string }).id === "string"
          ? (request as { id: string }).id
          : undefined,
      responseBody: undefined,
      responseData: undefined,
      responseHeaders: undefined,
      responseStatus: undefined,
      responseTime: undefined,
      responseSize: undefined,
      responseTimings: undefined,
      testResults: undefined,
    }),
    [activeProject, activeProjectPort],
  );

  const executeRequestWrapper = useCallback(
    async (tab: RequestTab, showLoading = true) => {
      if (showLoading) setLoadingCount((count) => count + 1);
      try {
        const envRecord: Record<string, string> = {};
        for (const v of allVars) {
          if (v.enabled !== false) envRecord[v.key] = v.value;
        }
        const ctx: RunnerContext = {
          environment: envRecord,
          iterationData: {} as Record<string, string>,
          iterationIndex: 0,
          log: (msg: string) => console.log("[script]", msg),
        };

        // Pre-request script
        if (tab.preRequestScript?.trim()) {
          let out;
          try {
            out = await runScript(tab.preRequestScript, ctx, {
              phase: "pre",
              timeoutMs: 5000,
            });
          } catch (scriptErr) {
            console.error("[executeRequestWrapper pre-request script]", scriptErr);
            toast({
              title: t("request.preScriptCrashed"),
              description: scriptErr instanceof Error ? scriptErr.message : String(scriptErr),
              variant: "destructive",
            });
            out = undefined;
          }
          if (out?.error) {
            toast({
              title: t("request.preScriptError"),
              description: out.error,
              variant: "destructive",
            });
          } else if (out && out.consoleLines.length > 0) {
            toast({
              title: t("request.preScriptOutput"),
              description: out.consoleLines.join("\n").slice(0, 200),
            });
          }
        }

        const scriptVars = Object.entries(ctx.environment).map(([key, value]) => ({
          key,
          value,
          enabled: true,
        }));
        const allVarsAfterScript = [...allVars, ...scriptVars];

        const resolvedUrl = interpolate(tab.url, allVarsAfterScript);
        const resolvedBody = interpolate(tab.body || "", allVarsAfterScript);
        const resolvedToken = interpolate(tab.authToken, allVarsAfterScript);
        if (
          hasUnresolvedPlaceholders(resolvedUrl) ||
          hasUnresolvedPlaceholders(resolvedBody) ||
          hasUnresolvedPlaceholders(resolvedToken)
        ) {
          notifyUnresolvedVariables();
          toast({
            title: t("request.unresolvedVariables"),
            description: t("request.unresolvedVariablesHint"),
            variant: "destructive",
          });
          return null;
        }

        // Expose the abort handle so the UI can cancel this request.
        const controller = new AbortController();
        abortRef.current = controller;
        let result: Awaited<ReturnType<typeof executeRequest>>;
        try {
          result = await executeRequest({
            tab,
            allVars: allVarsAfterScript,
            activeProjectPort,
            activeProject: !!activeProject,
            nativeMode,
            activeWorkspaceId: activeWorkspaceId ?? null,
            signal: controller.signal,
          });
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
        // Post-response script
        if (tab.postResponseScript?.trim()) {
          const responseForScript = {
            statusCode: result?.responseStatus ?? 0,
            responseTimeMs: result?.responseTime ?? 0,
            body: result?.responseBody ?? "",
            headers: (result?.responseHeaders ?? {}) as Record<string, string>,
          };
          let out;
          try {
            out = await runScript(tab.postResponseScript, ctx, {
              phase: "post",
              response: responseForScript,
              timeoutMs: 5000,
            });
          } catch (scriptErr) {
            console.error("[executeRequestWrapper post-response script]", scriptErr);
            toast({
              title: t("request.postScriptCrashed"),
              description: scriptErr instanceof Error ? scriptErr.message : String(scriptErr),
              variant: "destructive",
            });
            out = undefined;
          }
          if (out?.error) {
            toast({
              title: t("request.postScriptError"),
              description: out.error,
              variant: "destructive",
            });
          } else if (out && out.consoleLines.length > 0) {
            toast({
              title: t("request.postScriptOutput"),
              description: out.consoleLines.join("\n").slice(0, 200),
            });
          }
        }

        return result;
      } finally {
        if (showLoading) setLoadingCount((count) => Math.max(0, count - 1));
      }
    },
    [
      allVars,
      activeProjectPort,
      activeProject,
      nativeMode,
      activeWorkspaceId,
      setLoadingCount,
      notifyUnresolvedVariables,
      t,
    ],
  );

  const sendSpecificRequest = useCallback(
    async (tabToSend: RequestTab, showLoading = true) => {
      try {
        if (!tabToSend?.url?.trim()) {
          toast({
            title: t("request.missingUrl"),
            description: t("request.missingUrlHint"),
            variant: "destructive",
          });
          return null;
        }

        const result = await executeRequestWrapper(tabToSend, showLoading);
        if (!result) return null;
        updateTab(tabToSend.id, {
          hasResponse: true,
          responseStatus: result.responseStatus,
          responseTime: result.responseTime,
          responseSize: result.responseSize,
          responseBody: result.responseBody,
          responseData: result.responseData,
          responseHeaders: result.responseHeaders,
          responseTimings: result.responseTimings,
          transportError: result.transportError,
          testResults: result.testResults,
        });

        setCurrentRequest({
          id: tabToSend.id,
          method: tabToSend.method,
          url: tabToSend.url,
          endpoint: tabToSend.endpoint,
          headers: headersArrayToRecord(tabToSend.headers),
          body: tabToSend.body,
          queryParams: tabToSend.queryParams,
        });

        setLastResponse({
          status: result.responseStatus ?? 0,
          durationMs: result.responseTime ?? 0,
          headers: result.responseHeaders ?? {},
          body: result.responseBody,
          cookies: result.responseCookies ?? [],
        });

        addHistoryAndNotify({
          name: tabToSend.name,
          method: tabToSend.method,
          url: tabToSend.url,
          endpoint: tabToSend.endpoint,
          headers: headersArrayToRecord(tabToSend.headers),
          body: tabToSend.body,
          queryParams: tabToSend.queryParams,
          responseStatus: result.responseStatus ?? 0,
          responseTime: result.responseTime ?? 0,
          responseSize: result.responseSize ?? "0 B",
          responseBody: result.responseBody,
        });

        return result;
      } catch (err) {
        console.error("[sendSpecificRequest]", err);
        toast({
          title: t("request.executionFailed"),
          description: isTauriInvokeError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
          variant: "destructive",
        });
        return null;
      }
    },
    [executeRequestWrapper, updateTab, setCurrentRequest, setLastResponse, addHistoryAndNotify, t],
  );

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return {
    allVars,
    buildTabFromRequest,
    executeRequestWrapper,
    sendSpecificRequest,
    cancelRequest,
    notifyUnresolvedVariables,
  };
}
