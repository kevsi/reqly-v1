"use client";

/**
 * useRunnerExtractions — règles d'extraction de variables no-code (chaining)
 * du Runner. (extrait de page.tsx lors de la passe de dé-vibecodage)
 */

import { useState } from "react";
import type { VariableExtractionRule } from "@/lib/test-runner/types";

export function useRunnerExtractions() {
  const [extractions, setExtractions] = useState<VariableExtractionRule[]>([
    { id: "ext-1", source: "jsonPath", path: "$.token", variableName: "authToken" },
  ]);

  const addExtractionRule = () => {
    setExtractions((prev) => [
      ...prev,
      { id: `ext-${Date.now()}`, source: "jsonPath", path: "", variableName: "" },
    ]);
  };

  const removeExtractionRule = (id: string) => {
    setExtractions((prev) => prev.filter((r) => r.id !== id));
  };

  const updateExtractionRule = (id: string, patch: Partial<VariableExtractionRule>) => {
    setExtractions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return { extractions, addExtractionRule, removeExtractionRule, updateExtractionRule };
}
