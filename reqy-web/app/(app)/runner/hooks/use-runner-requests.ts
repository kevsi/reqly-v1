"use client";

/**
 * useRunnerRequests — sélection/réordonnancement/folders du Runner
 * (extrait de page.tsx lors de la passe de dé-vibecodage : la page portait
 * 27 useState + 8 effects).
 *
 * Gère : la séquence ordonnée (sync sur changement de collection), le dnd
 * (handlers + sensors), la checklist de sélection, l'expansion des dossiers,
 * et la persistance du réordonnancement dans la collection.
 */

import { useEffect, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { moveItemById } from "@/lib/test-runner/runner";
import type { Collection, RequestItem } from "@/hooks/use-request-store";

interface UseRunnerRequestsArgs {
  selectedId: string;
  /** Collection courante (peut être undefined si aucune sélection). */
  selected?: Collection;
  /** Écrit l'ordre dans la collection (persistance du dnd). */
  updateCollection: (id: string, updates: Partial<Collection>) => void;
}

export function useRunnerRequests({
  selectedId,
  selected,
  updateCollection,
}: UseRunnerRequestsArgs) {
  // Séquence ordonnée (dnd-kit, inspiré de collections-panel)
  const [orderedRequests, setOrderedRequests] = useState<RequestItem[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Sync ordered requests when collection changes
  useEffect(() => {
    if (selected?.requests) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrderedRequests([...selected.requests]);
    } else {
      setOrderedRequests([]);
    }
  }, [selectedId, selected]);

  // Checklist de sélection
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (selected?.requests) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRequestIds(new Set(selected.requests.map((r) => r.id)));
    } else {
      setSelectedRequestIds(new Set());
    }
  }, [selectedId, selected]);

  // Dossiers
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toggleFolderRequestsSelection = (folderId: string, requestsInFolder: RequestItem[]) => {
    const allChecked = requestsInFolder.every((r) => selectedRequestIds.has(r.id));
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      for (const r of requestsInFolder) {
        if (allChecked) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  };

  const handleDndStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDndEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    const fromId = String(active.id);
    const toId = String(over.id);
    setOrderedRequests((prev) => {
      const next = moveItemById(prev, fromId, toId);
      // Le réordonnancement persiste dans la collection : il survit au
      // rechargement et sert à l'ordre de la prochaine exécution.
      if (selectedId) updateCollection(selectedId, { requests: next });
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selected?.requests) {
      setSelectedRequestIds(new Set(selected.requests.map((r) => r.id)));
    }
  };

  const handleDeselectAll = () => {
    setSelectedRequestIds(new Set());
  };

  const handleResetSequence = () => {
    if (selected?.requests) {
      setOrderedRequests([...selected.requests]);
      setSelectedRequestIds(new Set(selected.requests.map((r) => r.id)));
    }
  };

  return {
    orderedRequests,
    activeDragId,
    dndSensors,
    selectedRequestIds,
    setSelectedRequestIds,
    expandedFolderIds,
    toggleFolderExpand,
    toggleFolderRequestsSelection,
    handleDndStart,
    handleDndEnd,
    handleSelectAll,
    handleDeselectAll,
    handleResetSequence,
  };
}
