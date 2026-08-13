"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { methodBadge } from "@/lib/http-method-colors";
import type { RequestItem } from "@/lib/types";
import { requestId } from "@/hooks/use-request-dnd";
import { useTranslation } from "react-i18next";

interface DraggableRequestRowProps {
  request: RequestItem;
  collectionId: string;
  isSelected: boolean;
  onSelect: () => void;
  onSend?: () => void;
  onRemove: () => void;
}

export function DraggableRequestRow({
  request,
  collectionId,
  isSelected,
  onSelect,
  onSend,
  onRemove,
}: DraggableRequestRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: requestId(request.id),
    data: {
      type: "request" as const,
      collectionId,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 py-1.5 px-3 pl-3 text-sm transition-all duration-150",
        isSelected && "bg-primary/[0.03]",
        "hover:bg-muted/20",
        isDragging && "z-10 opacity-50",
      )}
    >
      {/* Drag handle */}
      <button
        className="shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-muted-foreground/60 hover:bg-muted/30 transition-all duration-150 cursor-grab active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        {...attributes}
        {...listeners}
        tabIndex={0}
        aria-label={t("collections.row.dragLabel", { name: request.name })}
        data-testid={`drag-handle-${request.id}`}
      >
        <GripVertical className="size-3" />
      </button>

      {/* Method badge */}
      <span
        className={cn(
          "shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-white",
          methodBadge[request.method as keyof typeof methodBadge] ?? "bg-muted-foreground/30",
        )}
      >
        {request.method}
      </span>

      {/* Request name */}
      <button
        className="flex-1 min-w-0 text-left truncate text-foreground/80 hover:text-foreground"
        onClick={onSelect}
      >
        {request.name}
      </button>

      {/* Endpoint hint */}
      {request.endpoint && (
        <span className="hidden sm:block shrink-0 text-xs text-muted-foreground/40 font-mono truncate max-w-[160px]">
          {request.endpoint}
        </span>
      )}

      {/* Send button */}
      {onSend && (
        <button
          className="shrink-0 size-5 flex items-center justify-center rounded text-success/50 opacity-0 group-hover:opacity-100 transition-all duration-150 hover:scale-110 active:scale-95 hover:text-success hover:bg-success/10"
          onClick={onSend}
          title={t("collections.row.loadAndSend")}
        >
          <PlayIcon />
        </button>
      )}

      {/* Remove button */}
      <button
        className="shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-all duration-150 hover:scale-110 active:scale-95 hover:text-destructive hover:bg-destructive/10"
        onClick={onRemove}
        title={t("collections.row.removeRequest")}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

// ── Small inline icons (avoids extra lucide-react re-exports in this file) ──

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-2.5" aria-hidden="true">
      <polygon points="6,3 20,12 6,21" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="size-3"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}
