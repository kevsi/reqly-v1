"use client";

import { useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import {
  convertToRequestTestAssertions,
  convertToRunnerAssertions,
} from "@/lib/ai-assertion-converter";
import type { TestAssertion } from "@/src/ai/cloud-engine/actions";
import { useAIEngine, type AIEngineHandlers } from "@/src/ai/hooks/use-ai-engine";
import { generateFollowUpRequest } from "@/lib/ai-request-generator";
import { buildAiProxyPayload } from "@/lib/ai-config";
import { headersArrayToRecord, recordToHeaderArray } from "@/lib/request-tab-utils";
import { useRequestStore } from "@/hooks/use-request-store";
import { type HttpMethod, type RequestTab } from "@/lib/request-executor";
import type { RequestTabsState } from "@/hooks/use-request-tabs-state";
import type { HistoryItem } from "@/hooks/use-request-store";

export function useRequestAiEngine(
  state: RequestTabsState,
  // Pont volontairement non typé : le callback est construit par
  // useRequestExecutionCore avec des types stricts incompatibles avec les
  // shapes lâches passées ici (voir use-request-collection-runner).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildTabFromRequest: (request: any) => Partial<RequestTab>,
) {
  const { activeTab, activeTabId, setTabs, updateTab, setGeneratingFollowUpId, setHistoryOpen } =
    state;

  const { setCurrentRequest, setLastResponse } = useRequestStore();

  const syncActiveTabToAiStore = useCallback(() => {
    if (!activeTab) return;
    setCurrentRequest({
      id: activeTab.id,
      method: activeTab.method,
      url: activeTab.url,
      endpoint: activeTab.endpoint,
      headers: headersArrayToRecord(activeTab.headers),
      body: activeTab.body,
      queryParams: activeTab.queryParams,
    });
    if (activeTab.hasResponse) {
      setLastResponse({
        status: activeTab.responseStatus ?? 0,
        durationMs: activeTab.responseTime ?? 0,
        headers: activeTab.responseHeaders ?? {},
        body: activeTab.responseBody,
        cookies: activeTab.responseCookies ?? [],
      });
    }
  }, [activeTab, setCurrentRequest, setLastResponse]);

  const aiTabHandlers = useMemo<AIEngineHandlers>(
    () => ({
      setRequest: (patch) => {
        if (!activeTab) return;
        const tabPatch: Partial<RequestTab> = {};
        if (patch.method) tabPatch.method = patch.method as HttpMethod;
        if (patch.url) {
          tabPatch.url = patch.url;
          tabPatch.endpoint = patch.url.replace(/^https?:\/\/[^/]+/, "") || "/";
        }
        if (patch.headers) tabPatch.headers = recordToHeaderArray(patch.headers);
        if (patch.params) {
          tabPatch.queryParams = Object.entries(patch.params).map(([key, value]) => ({
            key,
            value: String(value),
          }));
        }
        if (patch.body !== undefined) {
          tabPatch.body =
            typeof patch.body === "string" ? patch.body : JSON.stringify(patch.body, null, 2);
          tabPatch.bodyType = "json";
        }
        updateTab(activeTab.id, tabPatch);
        syncActiveTabToAiStore();
      },
      addAssertions: (aiAssertions: TestAssertion[]) => {
        if (aiAssertions.length === 0) return;
        const incomingTests = convertToRequestTestAssertions(aiAssertions);
        const incomingRunner = convertToRunnerAssertions(aiAssertions);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? {
                  ...t,
                  assertions: [...(t.assertions ?? []), ...incomingTests],
                  runnerAssertions: [...(t.runnerAssertions ?? []), ...incomingRunner],
                }
              : t,
          ),
        );
        toast({
          title: `${incomingTests.length} assertion${incomingTests.length > 1 ? "s" : ""} ajoutée${incomingTests.length > 1 ? "s" : ""}`,
          description: "Consulte les onglets Tests et Assertions dans le panneau requête.",
        });
      },
      applyFix: (patch) => {
        if (!activeTab) return;
        const tabPatch: Partial<RequestTab> = {};
        if (patch.method) tabPatch.method = patch.method as HttpMethod;
        if (patch.url) {
          tabPatch.url = patch.url;
          tabPatch.endpoint = patch.url.replace(/^https?:\/\/[^/]+/, "") || "/";
        }
        if (patch.headers) tabPatch.headers = recordToHeaderArray(patch.headers);
        if (patch.body !== undefined) {
          tabPatch.body =
            typeof patch.body === "string" ? patch.body : JSON.stringify(patch.body, null, 2);
        }
        updateTab(activeTab.id, tabPatch);
        syncActiveTabToAiStore();
      },
    }),
    [activeTab, activeTabId, setTabs, updateTab, syncActiveTabToAiStore],
  );

  const aiEngine = useAIEngine(aiTabHandlers);

  const handleAnalyzeRequest = useCallback(async () => {
    syncActiveTabToAiStore();
    const ctx = aiEngine.buildContext();
    await aiEngine.analyzeAfterRequest(ctx);
  }, [aiEngine, syncActiveTabToAiStore]);

  const handleGenerateTests = useCallback(async () => {
    syncActiveTabToAiStore();
    const ctx = aiEngine.buildContext();
    await aiEngine.generateTests(ctx);
  }, [aiEngine, syncActiveTabToAiStore]);

  const handleGenerateFollowUp = useCallback(
    async (item: HistoryItem) => {
      const payload = buildAiProxyPayload("", "");
      if (!payload) {
        toast({
          title: "AI not configured",
          description: "Add an API key or Ollama in Settings → AI.",
          variant: "destructive",
          meta: { event: "aiError" },
        });
        return;
      }

      setGeneratingFollowUpId(item.id);
      try {
        const generated = await generateFollowUpRequest(item, payload);
        const aiAssertions = (generated.assertions ?? []) as TestAssertion[];
        const incomingTests = aiAssertions.length
          ? convertToRequestTestAssertions(aiAssertions)
          : undefined;
        const incomingRunner = aiAssertions.length
          ? convertToRunnerAssertions(aiAssertions)
          : undefined;
        updateTab(activeTab.id, {
          ...buildTabFromRequest({
            id: item.id,
            name: generated.name,
            method: generated.method,
            url: generated.url,
            endpoint: generated.endpoint || generated.url,
            headers: generated.headers,
            body: generated.body,
            queryParams: generated.queryParams,
            ...(incomingTests ? { assertions: incomingTests } : {}),
            ...(incomingRunner ? { runnerAssertions: incomingRunner } : {}),
            ...(generated.preRequestScript ? { preRequestScript: generated.preRequestScript } : {}),
            ...(generated.postResponseScript
              ? { postResponseScript: generated.postResponseScript }
              : {}),
            createdAt: item.createdAt,
            updatedAt: Date.now(),
          }),
          isSaved: false,
          savedRequestId: undefined,
        });
        setHistoryOpen(false);
        toast({
          title: "Follow-up request generated",
          description: generated.rationale || "Loaded in active editor.",
          meta: { event: "aiResponse" },
        });
      } catch (err) {
        toast({
          title: "AI generation failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
          meta: { event: "aiError" },
        });
      } finally {
        setGeneratingFollowUpId(null);
      }
    },
    [activeTab, updateTab, buildTabFromRequest, setHistoryOpen, setGeneratingFollowUpId],
  );

  return {
    syncActiveTabToAiStore,
    aiEngine,
    handleAnalyzeRequest,
    handleGenerateTests,
    handleGenerateFollowUp,
  };
}
