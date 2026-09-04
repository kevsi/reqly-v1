"use client";

import { useCallback } from "react";
import { RequestChainWorkflow } from "@/components/request-chain-workflow";
import type { ChainStep, ChainStepResult } from "@/components/request-chain-workflow";
import { useRequestStore } from "@/hooks/use-request-store";
import { executeRequest, type RequestTab } from "@/lib/request-executor";
import { recordToHeaderArray } from "@/lib/request-tab-utils";
import { computeDynamicVars } from "@/lib/variable-mapping";
import { extractValueFromResponse } from "@/lib/variable-path";
import { replaceLocalhostPort, uuidV4 } from "@/lib/utils";

export default function ChainsPage() {
  const onExecute = useCallback(async (steps: ChainStep[]): Promise<ChainStepResult[]> => {
    const state = useRequestStore.getState();
    const allRequests = state.collections.flatMap((col) => col.requests);
    const activeProject = state.projects.find((p) => p.id === state.selectedProjectId) ?? null;
    const activePort = activeProject?.port ?? 3000;
    const activeEnv = state.environments.find((e) => e.id === state.activeEnvironmentId);

    const allVars = [
      ...(activeEnv?.variables ?? []),
      ...computeDynamicVars(state.variableMappings, state.history),
    ];

    const results: ChainStepResult[] = [];

    for (const step of steps) {
      if (!step.enabled) continue;

      const request = step.requestId ? allRequests.find((r) => r.id === step.requestId) : undefined;
      if (!request || !request.url.trim()) continue;

      const tab: RequestTab = {
        id: `chain-${uuidV4()}`,
        name: request.name,
        method: request.method,
        url: activeProject ? replaceLocalhostPort(request.url, activePort) : request.url,
        endpoint: request.endpoint,
        headers: recordToHeaderArray(request.headers),
        queryParams: request.queryParams ?? [],
        pathParams: request.pathParams ?? [],
        body: request.body ?? "",
        bodyType: request.bodyType ?? "json",
        authType: request.authType ?? "none",
        authToken: request.authToken ?? "",
        runnerAssertions: request.runnerAssertions ?? [],
        preRequestScript: request.preRequestScript ?? "",
        postResponseScript: request.postResponseScript ?? "",
        protocol: request.protocol,
        graphql: request.graphql,
        datasetKey: request.datasetKey,
        hasResponse: false,
        isSaved: true,
      };

      try {
        const result = await executeRequest({
          tab,
          allVars,
          activeProjectPort: activePort,
          activeProject: Boolean(activeProject),
          nativeMode: false,
          activeWorkspaceId: state.activeWorkspaceId ?? null,
        });

        results.push({
          stepId: step.id,
          name: request.name,
          status: result.responseStatus,
          durationMs: result.responseTime ?? 0,
          error: result.transportError?.message,
        });

        if (!result.responseBody) continue;
        for (const extraction of step.extractVariables) {
          const target = extraction.targetVariable.trim();
          if (!target) continue;
          const { value } = extractValueFromResponse(result.responseBody, extraction.sourcePath);
          if (!value) continue;
          const existing = allVars.findIndex((v) => v.key === target);
          if (existing >= 0) allVars[existing] = { key: target, value, enabled: true };
          else allVars.push({ key: target, value, enabled: true });
        }
      } catch (err) {
        results.push({
          stepId: step.id,
          name: request.name,
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }, []);

  return (
    <main className="flex-1 overflow-auto p-6" data-testid="chains-page">
      <div className="max-w-5xl mx-auto">
        <RequestChainWorkflow onExecute={onExecute} />
      </div>
    </main>
  );
}
