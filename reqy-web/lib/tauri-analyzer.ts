//! Desktop-only bridge to the analyser-api scan (Rust spawns the Node CLI;
//! analyser-api runs on native ast-grep, not loadable in the webview).

import { isTauriAvailable } from "@/lib/tauri";
import type { AnalyserAnalysis } from "@/lib/analyser-mapping";

/**
 * Scans a backend folder via the Tauri `analyze_backend` command and returns
 * the parsed analyser-api JSON result.
 */
export async function scanBackend(folder: string): Promise<AnalyserAnalysis> {
  if (!isTauriAvailable()) {
    throw new Error("L'analyse d'un projet nécessite l'application desktop (Tauri).");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("analyze_backend", { folder });
  return JSON.parse(raw) as AnalyserAnalysis;
}
