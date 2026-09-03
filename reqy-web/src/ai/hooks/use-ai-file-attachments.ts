"use client";

import { useState, useCallback } from "react";
import type { FileAttachment } from "@/src/ai/components/ai-sidebar-types";
import {
  MAX_FILE_BYTES,
  MAX_FILE_TEXT_CHARS,
  MAX_FILES_COUNT,
} from "@/src/ai/agent/file-limits";

/**
 * Hook dédié à la gestion des fichiers joints dans le composer AI Sidebar.
 * Gère la lecture côté client, la détection UTF-8/UTF-16/binaire, et les limites de taille.
 */
export function useAiFileAttachments() {
  const [files, setFiles] = useState<FileAttachment[]>([]);

  const attachFiles = useCallback(async (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;

    /** Décode un buffer en texte en détectant le BOM — file.text() suppose
     *  toujours UTF-8 : un fichier UTF-16 (Windows/Notepad) donnerait des
     *  caractères NUL et serait classé binaire à tort. */
    const decodeBuffer = (buf: ArrayBuffer): string => {
      const head = new Uint8Array(buf.slice(0, 2));
      if (head[0] === 0xff && head[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buf.slice(2));
      }
      if (head[0] === 0xfe && head[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(buf.slice(2));
      }
      return new TextDecoder("utf-8").decode(buf);
    };

    const readAsText = async (file: File): Promise<FileAttachment> => {
      const base: FileAttachment = {
        id: `file:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      };
      if (file.size > MAX_FILE_BYTES) {
        return { ...base, unreadableReason: "too_large" };
      }
      try {
        const buf = await file.arrayBuffer();
        const raw = decodeBuffer(buf);
        // Heuristique binaire : trop de caractères de contrôle → pas de texte.
        const sample = raw.slice(0, 2000);
        let suspicious = 0;
        for (let i = 0; i < sample.length; i++) {
          const code = sample.charCodeAt(i);
          if ((code < 9 || (code > 13 && code < 32)) && code !== 27) suspicious++;
        }
        if (sample.length > 0 && suspicious / sample.length >= 0.4) {
          return { ...base, unreadableReason: "binary" };
        }
        return { ...base, text: raw.slice(0, MAX_FILE_TEXT_CHARS) };
      } catch {
        return { ...base, unreadableReason: "binary" };
      }
    };
    const parsed = await Promise.all(list.map(readAsText));
    // Plafond du nombre de fichiers : on garde les plus récents.
    setFiles((prev) => [...prev, ...parsed].slice(-MAX_FILES_COUNT));
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  return {
    files,
    setFiles,
    attachFiles,
    removeFile,
    clearFiles,
  };
}
