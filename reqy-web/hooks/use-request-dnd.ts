"use client";

// ── ID helpers ───────────────────────────────────────────────────────────

export const REQUEST_PREFIX = "req::";
export const COLLECTION_PREFIX = "col::";
export const FOLDER_PREFIX = "fld::";

export function requestId(id: string) {
  return `${REQUEST_PREFIX}${id}`;
}

export function collectionDropId(id: string) {
  return `${COLLECTION_PREFIX}${id}`;
}

export function folderDropId(collectionId: string, folderId: string) {
  return `${FOLDER_PREFIX}${collectionId}__${folderId}`;
}
