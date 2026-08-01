"use client";

/**
 * Domain hook: environments — typed Zustand selector with workspace filtering.
 *
 * Usage:
 *   const { environments, activeEnv, variables, addEnvironment } = useEnvironments();
 *   const { environments: all } = useEnvironments({ scoped: false });
 */

import { useRequestStore } from "@/hooks/use-request-store";
import type { Environment, EnvironmentVariable } from "@/hooks/request-types";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";
import { useMemo } from "react";

export interface UseEnvironmentsOptions {
  /** Filter environments to the active workspace (default: true). */
  scoped?: boolean;
}

export function useEnvironments(options: UseEnvironmentsOptions = {}) {
  const { scoped = true } = options;

  const environments = useRequestStore((s) => {
    if (!scoped) return s.environments;
    const wsId = s.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
    return s.environments.filter((e) => e.workspaceId === wsId);
  });

  const activeEnvironmentId = useRequestStore((s) => s.activeEnvironmentId);

  const activeEnv: Environment | undefined = useMemo(
    () => environments.find((e) => e.id === activeEnvironmentId),
    [environments, activeEnvironmentId],
  );

  const enabledVariables: EnvironmentVariable[] = useMemo(
    () => activeEnv?.variables?.filter((v) => v.enabled) ?? [],
    [activeEnv],
  );

  const variableMap: Record<string, string> = useMemo(
    () =>
      enabledVariables.reduce<Record<string, string>>((acc, v) => {
        acc[v.key] = v.value;
        return acc;
      }, {}),
    [enabledVariables],
  );

  const addEnvironment = useRequestStore((s) => s.addEnvironment);
  const updateEnvironment = useRequestStore((s) => s.updateEnvironment);
  const deleteEnvironment = useRequestStore((s) => s.deleteEnvironment);
  const setActiveEnvironment = useRequestStore((s) => s.setActiveEnvironment);

  return {
    environments,
    activeEnvironmentId,
    activeEnv,
    enabledVariables,
    variableMap,
    addEnvironment,
    updateEnvironment,
    deleteEnvironment,
    setActiveEnvironment,
  };
}
