/**
 * Orchestration d'export : format Bruno ou OpenCollection → soit une
 * arborescence écrite par la commande Tauri `export_files` (desktop,
 * dossier choisi par l'utilisateur), soit un .zip téléchargé (dev web).
 */

import type { Collection } from "@/lib/types";
import { buildBrunoFiles, type ExportFileMap } from "./bruno-export";
import { buildOpenCollectionFiles } from "./opencollection-export";
import { slugify } from "./bruno-export";

export type CollectionExportFormat = "json" | "bruno" | "opencollection";

export function buildCollectionFiles(
  collection: Collection,
  format: "bruno" | "opencollection",
): ExportFileMap {
  return format === "bruno" ? buildBrunoFiles(collection) : buildOpenCollectionFiles(collection);
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

async function downloadZip(files: ExportFileMap, rootName: string): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const folder = zip.folder(rootName) ?? zip;
  for (const [path, content] of files) {
    folder.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${rootName}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportCollectionFiles(
  collection: Collection,
  format: "bruno" | "opencollection",
): Promise<string> {
  const files = buildCollectionFiles(collection, format);
  const rootName = slugify(collection.name);

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("export_files", {
      rootName,
      files: Array.from(files.entries()),
    });
  }

  await downloadZip(files, rootName);
  return `${rootName}.zip`;
}
