// ── Sélecteur de dossier unifié (Tauri + Web) ──────────────────────────
// Desktop (Tauri) : dialogue système natif → chemin réel du disque.
// Web (Chromium)  : File System Access API (`showDirectoryPicker`) → handle.
// Web (repli)     : Origin Private File System (`navigator.storage`) →
//                   dossier virtuel nommé par l'utilisateur (Firefox/Safari).

import { isTauriAvailable } from "./tauri";

export interface PickedFolder {
  /** Chemin réel (desktop/Tauri uniquement) */
  path: string | null;
  /** Handle du dossier (web — File System Access API ou OPFS) */
  handle: FileSystemDirectoryHandle | null;
  /** Nom affichable du dossier */
  name: string;
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

/** Vrai si un sélecteur de dossier natif est disponible (Tauri ou web Chromium). */
export function canPickFolder(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauriAvailable()) return true;
  const w = window as unknown as DirectoryPickerWindow;
  return typeof w.showDirectoryPicker === "function";
}

/**
 * Ouvre le sélecteur de dossier natif.
 * - Tauri : dialogue système → chemin réel (`path`).
 * - Web   : `showDirectoryPicker()` (Chrome/Edge) → handle du dossier.
 * Retourne `null` si l'utilisateur annule ou si aucun sélecteur n'est dispo.
 */
export async function pickFolder(): Promise<PickedFolder | null> {
  // Desktop : dialogue natif Tauri
  if (isTauriAvailable()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        const name = selected.split(/[\\/]/).filter(Boolean).pop() ?? selected;
        return { path: selected, handle: null, name };
      }
      return null;
    } catch {
      // repli : saisie manuelle
    }
  }

  // Web : File System Access API (Chromium)
  const w = window as unknown as DirectoryPickerWindow;
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const handle = await w.showDirectoryPicker({ mode: "readwrite" });
      return { path: null, handle, name: handle.name };
    } catch {
      // AbortError (annulation) ou API indisponible → rien de sélectionné
      return null;
    }
  }

  return null;
}

/**
 * Ouvre (ou crée) un dossier virtuel dans l'Origin Private File System.
 * Repli pour les navigateurs sans `showDirectoryPicker` : le "chemin" saisi
 * par l'utilisateur devient le nom d'un sous-dossier OPFS. L'OPFS est
 * disponible dans tous les navigateurs modernes, sans dialogue de permission,
 * et reste isolé à l'origine.
 */
export async function pickVirtualFolder(name: string): Promise<PickedFolder | null> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.getDirectory) return null;
  const root = await storage.getDirectory();
  const sanitized = sanitizeFolderName(name);
  const handle = await root.getDirectoryHandle(sanitized, { create: true });
  return { path: null, handle, name: sanitized };
}

/**
 * Parcourt un dossier réel via l'input `<input type="file" webkitdirectory>`
 * (disponible dans tous les navigateurs) et importe son contenu dans un
 * dossier virtuel OPFS. C'est le repli des navigateurs sans
 * `showDirectoryPicker` : on ne peut pas obtenir de handle écrivable sur un
 * dossier réel hors Chromium, on travaille donc sur une copie.
 */
export async function pickFolderImport(): Promise<PickedFolder | null> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.getDirectory) return null;

  const files = await browseDirectoryFiles();
  if (!files || files.length === 0) return null;

  // Le premier fichier donne le nom du dossier racine via webkitRelativePath
  // (format "NomDuDossier/chemin/vers/fichier").
  const rootName = sanitizeFolderName((files[0].webkitRelativePath || files[0].name).split("/")[0]);
  const opfsRoot = await storage.getDirectory();
  const handle = await opfsRoot.getDirectoryHandle(rootName, { create: true });

  for (const file of files) {
    const parts = file.webkitRelativePath.split("/").slice(1);
    if (parts.length === 0) continue;
    let dir = handle;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
  }

  return { path: null, handle, name: rootName };
}

/** Ouvre un dialogue de sélection de dossier (webkitdirectory) et renvoie ses fichiers. */
function browseDirectoryFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // `webkitdirectory` ouvre un sélecteur de DOSSIER (pas de fichiers) dans
    // tous les navigateurs ; les attributs multiples/facultatifs sont pour
    // les très vieux Safari.
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.multiple = true;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Réduit un chemin saisi à un simple nom de dossier (segment unique, sans "/"). */
function sanitizeFolderName(name: string): string {
  const clean =
    name
      .trim()
      .replace(/[\\/]+/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() ?? "";
  const fallback = clean.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.]+/, "") || "repo";
  return fallback.slice(0, 64);
}

/**
 * Importe un dossier glissé-déposé (Drag & Drop) dans l'OPFS.
 * Ne déclenche AUCUNE fenêtre de confirmation ("Importer XX fichiers sur ce site ?") du navigateur.
 */
export async function importDroppedFolder(
  items: DataTransferItemList,
): Promise<PickedFolder | null> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.getDirectory) return null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry && entry.isDirectory) {
      const rootName = sanitizeFolderName(entry.name);
      const opfsRoot = await storage.getDirectory();
      const rootHandle = await opfsRoot.getDirectoryHandle(rootName, { create: true });

      const scanEntry = async (dirEntry: any, targetHandle: FileSystemDirectoryHandle) => {
        const reader = dirEntry.createReader();
        const readEntries = (): Promise<any[]> => new Promise((res) => reader.readEntries(res));
        let entries: any[] = [];
        let batch: any[] = [];
        do {
          batch = await readEntries();
          entries = entries.concat(batch);
        } while (batch.length > 0);

        for (const child of entries) {
          if (child.isFile) {
            try {
              const file: File = await new Promise((res, rej) => child.file(res, rej));
              const fileHandle = await targetHandle.getFileHandle(child.name, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(file);
              await writable.close();
            } catch {
              // ignore unreadable
            }
          } else if (child.isDirectory) {
            if (child.name === ".git" || child.name === "node_modules") continue;
            const subHandle = await targetHandle.getDirectoryHandle(child.name, { create: true });
            await scanEntry(child, subHandle);
          }
        }
      };

      await scanEntry(entry, rootHandle);
      return { path: null, handle: rootHandle, name: rootName };
    }
  }

  return null;
}
