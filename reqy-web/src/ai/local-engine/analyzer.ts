/**
 * Analyzer — orchestrates rule execution against a RequestContext.
 * Pure function, no side effects. Returns diagnostics sorted by severity.
 */
import type { Diagnostic, RequestContext, Severity } from "@/src/ai/types";
import { allRules } from "@/src/ai/local-engine/rules";

const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function analyze(ctx: RequestContext): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const rule of allRules) {
    let matches: boolean;
    try {
      matches = rule.match(ctx);
    } catch {
      continue;
    }
    if (!matches) continue;

    let built;
    try {
      built = rule.build(ctx);
    } catch {
      continue;
    }

    const diagnostic: Diagnostic = {
      ...built,
      id: rule.id,
      source: "local",
      timestamp: Date.now(),
    };
    if (seen.has(diagnostic.id)) continue;
    seen.add(diagnostic.id);
    diagnostics.push(diagnostic);
  }

  diagnostics.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return diagnostics;
}
