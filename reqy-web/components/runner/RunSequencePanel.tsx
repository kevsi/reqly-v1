"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GripVertical,
  ArrowUpDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { methodText } from "@/lib/http-method-colors";
import { useTranslation } from "react-i18next";
import type { RequestItem, CollectionFolder } from "@/hooks/request-types";

interface RunSequencePanelProps {
  orderedRequests: RequestItem[];
  setOrderedRequests: Dispatch<SetStateAction<RequestItem[]>>;
  selectedRequestIds: Set<string>;
  setSelectedRequestIds: Dispatch<SetStateAction<Set<string>>>;
  expandedFolderIds: Set<string>;
  setExpandedFolderIds: Dispatch<SetStateAction<Set<string>>>;
  collectionFolders: CollectionFolder[];
  isRunning: boolean;
  draggedIdx: number | null;
  setDraggedIdx: Dispatch<SetStateAction<number | null>>;
  totalCollectionRequests: number;
  selectedCount: number;
  onResetSequence: () => void;
}

export function RunSequencePanel({
  orderedRequests,
  setOrderedRequests,
  selectedRequestIds,
  setSelectedRequestIds,
  expandedFolderIds,
  setExpandedFolderIds,
  collectionFolders,
  isRunning,
  draggedIdx,
  setDraggedIdx,
  totalCollectionRequests,
  selectedCount,
  onResetSequence,
}: RunSequencePanelProps) {
  const { t } = useTranslation();

  const toggleFolderExpand = useCallback(
    (folderId: string) => {
      setExpandedFolderIds((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return next;
      });
    },
    [setExpandedFolderIds],
  );

  const toggleFolderRequestsSelection = useCallback(
    (folderId: string, requestsInFolder: RequestItem[]) => {
      const allChecked = requestsInFolder.every((r) => selectedRequestIds.has(r.id));
      setSelectedRequestIds((prev) => {
        const next = new Set(prev);
        for (const r of requestsInFolder) {
          if (allChecked) next.delete(r.id);
          else next.add(r.id);
        }
        return next;
      });
    },
    [selectedRequestIds, setSelectedRequestIds],
  );

  const toggleRequestSelection = useCallback(
    (id: string) => {
      setSelectedRequestIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setSelectedRequestIds],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedRequestIds(new Set(orderedRequests.map((r) => r.id)));
  }, [orderedRequests, setSelectedRequestIds]);

  const handleDeselectAll = useCallback(() => {
    setSelectedRequestIds(new Set());
  }, [setSelectedRequestIds]);

  const handleDragStart = useCallback(
    (idx: number) => {
      setDraggedIdx(idx);
    },
    [setDraggedIdx],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (draggedIdx === null || draggedIdx === idx) return;
      setOrderedRequests((prev) => {
        const copy = [...prev];
        const [removed] = copy.splice(draggedIdx, 1);
        copy.splice(idx, 0, removed);
        return copy;
      });
      setDraggedIdx(idx);
    },
    [draggedIdx, setOrderedRequests, setDraggedIdx],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIdx(null);
  }, [setDraggedIdx]);

  const requestsInNoFolder = orderedRequests.filter(
    (r) => !r.folderId || !collectionFolders.some((f) => f.id === r.folderId),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span className="size-4 text-primary" style={{ strokeWidth: 2 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          Run Sequence
          <Badge variant="outline" className="text-[10px] gap-1 font-mono">
            <ArrowUpDown className="size-3" />
            Drag & Drop
          </Badge>
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleDeselectAll}
            className="text-primary hover:underline font-medium"
            disabled={isRunning}
          >
            Deselect All
          </button>
          <span className="text-muted-foreground">•</span>
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-primary hover:underline font-medium"
            disabled={isRunning}
          >
            Select All
          </button>
          <span className="text-muted-foreground">•</span>
          <button
            type="button"
            onClick={onResetSequence}
            className="text-primary hover:underline font-medium"
            disabled={isRunning}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="text-xs flex items-center justify-between text-muted-foreground">
        <span>Glissez pour réordonner, cochez pour inclure</span>
        <span className="font-mono text-[11px] font-semibold text-foreground">
          {selectedCount} / {totalCollectionRequests} sélectionnée{selectedCount > 1 ? "s" : ""}
        </span>
      </div>

      <div className="max-h-[560px] overflow-y-auto hide-scrollbar space-y-1">
        {orderedRequests.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {t("runner.noRequests")}
          </div>
        ) : (
          <>
            {/* Folders tree rendering */}
            {collectionFolders.map((folder) => {
              const requestsInFolder = orderedRequests.filter((r) => r.folderId === folder.id);
              if (requestsInFolder.length === 0) return null;
              const isFolderExpanded = expandedFolderIds.has(folder.id);
              const folderChecked = requestsInFolder.every((r) => selectedRequestIds.has(r.id));

              return (
                <div key={folder.id} className="mb-2 border rounded-md overflow-hidden bg-muted/10">
                  <div className="flex items-center gap-2 p-2 bg-muted/30 border-b text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleFolderExpand(folder.id)}
                      className="p-0.5 hover:bg-muted rounded"
                    >
                      {isFolderExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <input
                      type="checkbox"
                      checked={folderChecked}
                      onChange={() => toggleFolderRequestsSelection(folder.id, requestsInFolder)}
                      disabled={isRunning}
                      className="rounded border-border text-primary size-3.5"
                    />
                    {isFolderExpanded ? (
                      <FolderOpen className="size-4 text-amber-500" />
                    ) : (
                      <Folder className="size-4 text-amber-500" />
                    )}
                    <span className="truncate flex-1 text-foreground">{folder.name}</span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      ({requestsInFolder.length})
                    </span>
                  </div>

                  {isFolderExpanded && (
                    <div className="p-1 pl-4 space-y-1">
                      {requestsInFolder.map((req) => {
                        const globalIdx = orderedRequests.findIndex((r) => r.id === req.id);
                        const isChecked = selectedRequestIds.has(req.id);
                        const methodClass = methodText[req.method] ?? "text-muted-foreground";

                        return (
                          <div
                            key={req.id}
                            draggable={!isRunning}
                            onDragStart={() => handleDragStart(globalIdx)}
                            onDragOver={(e) => handleDragOver(e, globalIdx)}
                            onDragEnd={handleDragEnd}
                            onClick={() => !isRunning && toggleRequestSelection(req.id)}
                            className={cn(
                              "flex items-center gap-2 p-1.5 rounded border text-xs transition-colors cursor-pointer select-none",
                              isChecked
                                ? "bg-card border-border hover:bg-muted/40"
                                : "bg-muted/10 border-transparent opacity-60 hover:opacity-100",
                              draggedIdx === globalIdx && "opacity-40 border-primary border-dashed",
                            )}
                          >
                            <GripVertical className="size-3 text-muted-foreground/40 shrink-0 cursor-grab" />
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              disabled={isRunning}
                              className="rounded border-border text-primary size-3 shrink-0"
                            />
                            <span
                              className={cn(
                                "font-mono text-[10px] font-bold shrink-0 w-10",
                                methodClass,
                              )}
                            >
                              {req.method}
                            </span>
                            <span className="font-medium text-foreground truncate flex-1 min-w-0">
                              {req.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Top-level requests outside folders */}
            {requestsInNoFolder.length > 0 && (
              <div className="space-y-1">
                {requestsInNoFolder.map((req) => {
                  const globalIdx = orderedRequests.findIndex((r) => r.id === req.id);
                  const isChecked = selectedRequestIds.has(req.id);
                  const methodClass = methodText[req.method] ?? "text-muted-foreground";

                  return (
                    <div
                      key={req.id}
                      draggable={!isRunning}
                      onDragStart={() => handleDragStart(globalIdx)}
                      onDragOver={(e) => handleDragOver(e, globalIdx)}
                      onDragEnd={handleDragEnd}
                      onClick={() => !isRunning && toggleRequestSelection(req.id)}
                      className={cn(
                        "flex items-center gap-2.5 p-2 rounded-md border text-xs transition-colors cursor-pointer select-none",
                        isChecked
                          ? "bg-card border-border hover:bg-muted/40"
                          : "bg-muted/10 border-transparent opacity-60 hover:opacity-100",
                        draggedIdx === globalIdx && "opacity-40 border-primary border-dashed",
                      )}
                    >
                      <span className="font-mono text-[11px] text-muted-foreground w-4 text-right shrink-0">
                        {globalIdx + 1}
                      </span>
                      <GripVertical className="size-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        disabled={isRunning}
                        className="rounded border-border text-primary focus:ring-primary size-3.5 shrink-0"
                      />
                      <span
                        className={cn("font-mono text-[11px] font-bold shrink-0 w-12", methodClass)}
                      >
                        {req.method}
                      </span>
                      <span className="font-medium text-foreground truncate flex-1 min-w-0">
                        {req.name}
                      </span>
                      {req.runnerAssertions && req.runnerAssertions.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1 font-mono shrink-0"
                        >
                          {req.runnerAssertions.length} assert
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
