"use client";

/**
 * useRunnerDataset — chargement CSV/JSON du dataset data-driven du Runner
 * (extrait de page.tsx lors de la passe de dé-vibecodage). Porte aussi le
 * calcul de preview et la détection de colonnes sans placeholder correspondant.
 */

import { useCallback, useMemo, useState } from "react";
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven";
import type { RequestItem } from "@/hooks/use-request-store";

interface UseRunnerDatasetArgs {
  orderedRequests: RequestItem[];
  selectedRequestIds: Set<string>;
  /** t() pour les messages d'erreur localisés. */
  t: (key: string) => string;
}

export function useRunnerDataset({ orderedRequests, selectedRequestIds, t }: UseRunnerDatasetArgs) {
  const [, setDatasetText] = useState("");
  const [datasetRows, setDatasetRows] = useState<Record<string, string>[]>([]);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetFileName, setDatasetFileName] = useState<string | null>(null);

  const datasetPreviewColumns = useMemo(
    () => Object.keys(datasetRows[0] ?? {}).slice(0, 6),
    [datasetRows],
  );
  const datasetPreviewRows = useMemo(() => datasetRows.slice(0, 3), [datasetRows]);

  // Une colonne de dataset matche-t-elle un placeholder {{x}} des requêtes sélectionnées ?
  const unmatchedDatasetColumns = useMemo(() => {
    if (datasetRows.length === 0) return false;
    const placeholders = new Set<string>();
    const selectedReqs = orderedRequests.filter((r) => selectedRequestIds.has(r.id));
    for (const req of selectedReqs) {
      const haystack = [
        req.url ?? "",
        req.body ?? "",
        Object.values(req.headers ?? {}).join(" "),
      ].join("\n");
      for (const m of haystack.matchAll(/\{\{(\w+)\}\}/g)) placeholders.add(m[1]);
    }
    if (placeholders.size === 0) return false;
    const columns = new Set<string>();
    for (const row of datasetRows) {
      for (const k of Object.keys(row)) columns.add(k);
    }
    for (const p of placeholders) {
      if (columns.has(p)) return false;
    }
    return true;
  }, [datasetRows, orderedRequests, selectedRequestIds]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setDatasetError(null);
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        setDatasetText(text);
        setDatasetFileName(file.name);
        try {
          setDatasetRows(loadJsonDataset(text));
          return;
        } catch {
          /* pas du JSON — tenter CSV */
        }
        try {
          const rows = loadCsvDataset(text);
          if (rows.length === 0) {
            setDatasetError(t("runner.errorNoRows"));
            return;
          }
          setDatasetRows(rows);
        } catch (e) {
          setDatasetError(e instanceof Error ? e.message : t("runner.errorParse"));
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [t],
  );

  const handleClearDataset = useCallback(() => {
    setDatasetText("");
    setDatasetRows([]);
    setDatasetError(null);
    setDatasetFileName(null);
  }, []);

  return {
    datasetRows,
    datasetError,
    datasetFileName,
    datasetPreviewColumns,
    datasetPreviewRows,
    unmatchedDatasetColumns,
    handleFileUpload,
    handleClearDataset,
  };
}
