"use client";

import { useState, useCallback } from "react";
import {
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Collection } from "@/lib/types";

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

export function parseRequestId(composite: string) {
  return composite.startsWith(REQUEST_PREFIX) ? composite.slice(REQUEST_PREFIX.length) : composite;
}

export function parseCollectionDropId(composite: string) {
  return composite.startsWith(COLLECTION_PREFIX)
    ? composite.slice(COLLECTION_PREFIX.length)
    : composite;
}

export function parseFolderDropId(
  composite: string,
): { collectionId: string; folderId: string } | null {
  if (!composite.startsWith(FOLDER_PREFIX)) return null;
  const rest = composite.slice(FOLDER_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep === -1) return null;
  return { collectionId: rest.slice(0, sep), folderId: rest.slice(sep + 2) };
}

// ── Drag item descriptor ─────────────────────────────────────────────────

export interface DragItemDescriptor {
  requestId: string;
  sourceCollectionId: string;
  name: string;
  method: string;
}

// ── Collision helpers ────────────────────────────────────────────────────

/**
 * Given an active request ID (composite) and the collection it belongs to,
 * find the index within the collection where it should be inserted.
 *
 * "Before" means the item appears above the target; "after" means below.
 * For simplicity we always insert *before* the target item when dropping
 * on a sortable element.
 */
export function findInsertIndex(targetRequestId: string, targetRequests: { id: string }[]): number {
  return targetRequests.findIndex((r) => r.id === targetRequestId);
}

// ── Hook ─────────────────────────────────────────────────────────────────

export interface UseRequestDndOptions {
  collections: Collection[];
  onReorderInCollection: (collectionId: string, orderedRequestIds: string[]) => void;
  onMoveBetweenCollections: (
    sourceCollectionId: string,
    targetCollectionId: string,
    requestId: string,
    targetIndex: number,
  ) => void;
}

export function useRequestDnd({
  collections,
  onReorderInCollection,
  onMoveBetweenCollections,
}: UseRequestDndOptions) {
  const [activeItem, setActiveItem] = useState<DragItemDescriptor | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const data = active.data.current as { type: "request"; collectionId: string } | undefined;
      if (!data || data.type !== "request") return;
      const rawId = (active.id as string).startsWith(REQUEST_PREFIX)
        ? (active.id as string).slice(REQUEST_PREFIX.length)
        : (active.id as string);
      // Search all collections for the request
      for (const col of collections) {
        const req = col.requests.find((r) => r.id === rawId);
        if (req) {
          setActiveItem({
            requestId: req.id,
            sourceCollectionId: data.collectionId,
            name: req.name,
            method: req.method,
          });
          return;
        }
      }
    },
    [collections],
  );

  // We re-check collections on drag end in case the store updated mid-drag
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null);
      const { active, over } = event;
      if (!over) return;

      const activeRawId = active.id as string;
      const requestId = parseRequestId(activeRawId);
      const activeData = active.data.current as
        { type: "request"; collectionId: string } | undefined;
      if (!activeData || activeData.type !== "request") return;

      const overRawId = over.id as string;
      const overData = over.data.current as
        { type: "request" | "collection"; collectionId: string } | undefined;
      if (!overData) return;

      const sourceColId = activeData.collectionId;
      const targetColId = overData.collectionId;

      if (overData.type === "request") {
        // Dropped on a request row
        const targetRequestId = parseRequestId(overRawId);

        if (sourceColId === targetColId) {
          // ── Intra-collection reorder ──
          const sourceCol = collections.find((c) => c.id === sourceColId);
          if (!sourceCol) return;
          const siblings = sourceCol.requests.map((r) => r.id);
          const fromIdx = siblings.indexOf(requestId);
          const toIdx = siblings.indexOf(targetRequestId);
          if (fromIdx === -1 || toIdx === -1) return;
          siblings.splice(fromIdx, 1);
          siblings.splice(toIdx, 0, requestId);
          onReorderInCollection(sourceColId, siblings);
        } else {
          // ── Cross-collection move (insert before target) ──
          const targetCol = collections.find((c) => c.id === targetColId);
          if (!targetCol) return;
          const insertBefore = targetCol.requests.findIndex((r) => r.id === targetRequestId);
          const insertAt = insertBefore >= 0 ? insertBefore : targetCol.requests.length;
          onMoveBetweenCollections(sourceColId, targetColId, requestId, insertAt);
        }
      } else if (overData.type === "collection") {
        // ── Dropped on a collection drop-zone (append to end) ──
        if (sourceColId === targetColId) return; // no-op
        const targetCol = collections.find((c) => c.id === targetColId);
        const insertAt = targetCol?.requests.length ?? 0;
        onMoveBetweenCollections(sourceColId, targetColId, requestId, insertAt);
      }
    },
    [collections, onReorderInCollection, onMoveBetweenCollections],
  );

  return {
    sensors,
    activeItem,
    handleDragStart,
    handleDragEnd,
  };
}
