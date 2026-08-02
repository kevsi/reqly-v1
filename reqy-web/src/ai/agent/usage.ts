import type { AgentUsage } from "./types";

export function emptyUsage(): AgentUsage {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

export function addUsage(
  prev: AgentUsage,
  delta: { inputTokens: number; outputTokens: number },
): AgentUsage {
  return {
    inputTokens: prev.inputTokens + delta.inputTokens,
    outputTokens: prev.outputTokens + delta.outputTokens,
    calls: prev.calls + 1,
  };
}

export function mergeUsages(usages: AgentUsage[]): AgentUsage {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      calls: acc.calls + u.calls,
    }),
    emptyUsage(),
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatTokens(usage: AgentUsage): string {
  if (usage.calls === 0) return "";
  return `${formatNumber(usage.inputTokens)} in / ${formatNumber(usage.outputTokens)} out`;
}
