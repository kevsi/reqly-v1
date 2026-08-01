"use client";

import React, { useState, useCallback } from "react";
import {
  Square,
  CheckSquare,
  GripVertical,
  Play,
  MoreHorizontal,
  FolderPlus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { methodSubtle } from "@/lib/http-method-colors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RequestItem } from "@/hooks/use-request-store";

interface RequestTreeItemProps {
  request: RequestItem;
  collectionId: string;
  collectionName: string;
  depth: number;
  isLastSibling: boolean;
  stems: number[];
  isSelected: boolean;
  isDragging: boolean;
  allRequests: RequestItem[];
  onToggleSelect: (collectionId: string, requestId: string) => void;
  onSelect: (request: RequestItem) => void;
  onSelectAndSend?: (request: RequestItem) => void;
  onRemove: (collectionId: string, requestId: string) => void;
  onStartMove: (requestId: string) => void;
  onConfirmDelete: (label: string, onConfirm: () => void) => void;
  onReorder?: (collectionId: string, folderId: string | null, orderedRequestIds: string[]) => void;
  onDragStateChange: (dragId: string | null) => void;
  /** Returns the folder ID currently being hovered over during drag, or null. */
  getDropTargetFolderId?: () => string | null;
  /** Called when a request is dropped on a different folder. */
  onMoveToFolder?: (requestId: string, folderId: string | null) => void;
  /** Called on drag start / hovering a request to clear the folder drop target ref. */
  onClearFolderDropTarget?: () => void;
}

export function RequestTreeItem({
  request,
  collectionId,
  collectionName,
  depth,
  isLastSibling,
  stems,
  isSelected,
  isDragging,
  allRequests,
  onToggleSelect,
  onSelect,
  onSelectAndSend,
  onRemove,
  onStartMove,
  onConfirmDelete,
  onReorder,
  onDragStateChange,
  getDropTargetFolderId,
  onMoveToFolder,
  onClearFolderDropTarget,
}: RequestTreeItemProps) {
  const dragOverRef = React.useRef<string | null>(null);
  const indent = depth * 20;

  const handleDragEnd = useCallback(() => {
    const draggedId = request.id;

    // Check if dropped on a folder (cross-folder move)
    const dropFolderId = getDropTargetFolderId?.();
    if (dropFolderId && dropFolderId !== request.folderId && onMoveToFolder) {
      onMoveToFolder(draggedId, dropFolderId);
    } else {
      // Existing sibling reorder logic
      const targetId = dragOverRef.current;
      if (draggedId && targetId && onReorder && draggedId !== targetId) {
        const folderId = request.folderId ?? null;
        const siblings = allRequests.filter((r) => r.folderId === folderId).map((r) => r.id);
        const fromIdx = siblings.indexOf(draggedId);
        const toIdx = siblings.indexOf(targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
          siblings.splice(fromIdx, 1);
          siblings.splice(toIdx, 0, draggedId);
          onReorder(collectionId, folderId, siblings);
        }
      }
    }

    onDragStateChange(null);
    dragOverRef.current = null;
  }, [
    request.id,
    request.folderId,
    allRequests,
    onReorder,
    collectionId,
    onDragStateChange,
    getDropTargetFolderId,
    onMoveToFolder,
  ]);

  return (
    <div className="relative group">
      {/* Connector tree lines */}
      {stems.map((sd) => (
        <span
          key={sd}
          className="absolute left-0 top-0 h-full w-px bg-border/40"
          style={{ left: `${sd * 20 + 6}px` }}
        />
      ))}
      {depth > 0 && (
        <>
          <span
            className="absolute top-1/2 h-px w-[10px] -translate-y-1/2 bg-border/40"
            style={{ left: `${indent + 6}px` }}
          />
          {!isLastSibling && (
            <span
              className="absolute left-0 top-0 h-full w-px bg-border/40"
              style={{ left: `${indent + 6}px` }}
            />
          )}
        </>
      )}

      <div
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-all duration-150",
          "hover:bg-accent/30 hover:shadow-xs",
          isSelected && "bg-primary/[0.04] ring-1 ring-primary/20",
          isDragging && "opacity-40 scale-[0.98]",
        )}
        style={{ paddingLeft: `${indent + 20}px` }}
        draggable={!!onReorder}
        onDragStart={(e) => {
          onDragStateChange(request.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", request.id);
          dragOverRef.current = null;
          onClearFolderDropTarget?.();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          dragOverRef.current = request.id;
          onClearFolderDropTarget?.();
        }}
        onDragEnd={handleDragEnd}
      >
        {onReorder && (
          <div className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/10 hover:text-muted-foreground/30 transition-colors duration-200">
            <GripVertical className="size-3" />
          </div>
        )}

        <button
          onClick={() => onToggleSelect(collectionId, request.id)}
          className={cn(
            "shrink-0 flex items-center justify-center transition-all duration-150",
            isSelected ? "text-primary" : "text-muted-foreground/20 hover:text-muted-foreground/50",
          )}
        >
          {isSelected ? (
            <span className="flex size-4 items-center justify-center rounded bg-primary/10">
              <CheckSquare className="size-3 text-primary" />
            </span>
          ) : (
            <Square className="size-3" />
          )}
        </button>

        <button
          onClick={() => onSelect(request)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide leading-none shadow-xs",
              methodSubtle[request.method].replace("border-", "ring-1 ring-").replace("/30", "/20"),
            )}
          >
            {request.method}
          </span>
          <span className="truncate text-sm text-foreground/85 group-hover:text-foreground transition-colors">
            {request.name || request.endpoint || request.url}
          </span>
          {request.endpoint && (
            <span className="hidden sm:inline ml-auto shrink-0 truncate text-[10px] text-muted-foreground/40 max-w-[100px] font-mono">
              {request.endpoint}
            </span>
          )}
        </button>

        {onSelectAndSend && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectAndSend(request)}
            className="size-6 p-0 text-muted-foreground/30 hover:text-success hover:bg-success/10 opacity-0 group-hover:opacity-100 transition-all duration-150"
            title="Load & execute"
          >
            <Play className="size-3" />
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-5 p-0 text-muted-foreground/30 hover:text-foreground hover:bg-accent/60 opacity-0 group-hover:opacity-100 transition-all duration-150"
            >
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => onStartMove(request.id)}>
              <FolderPlus className="mr-2 size-3.5" /> Move
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                onConfirmDelete(`Remove "${request.name}" from "${collectionName}"?`, () =>
                  onRemove(collectionId, request.id),
                )
              }
              className="text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
