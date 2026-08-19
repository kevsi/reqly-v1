import type { AnalysisResult } from "../types.ts";

export function toJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}
