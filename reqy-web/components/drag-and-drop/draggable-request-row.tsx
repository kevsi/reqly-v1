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
  depth?: number;
}

export function DraggableRequestRow({
  request,
  collectionId,
  isSelected,
  onSelect,
  onSend,
  onRemove,
  depth = 0,
}: DraggableRequestRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: requestId(request.id),
    data: {
      type: "request" as const,
      collectionId,
    },
  });

  // Indentation hiérarchique : 0 = à l'intérieur de la collection (wrapper ml-[32px] + border), 1+ = sous-dossier (+14px/niveau) — aligné avec dossiers
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${6 + depth * 14}px`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/req flex items-center gap-2 py-2 pr-2 text-sm transition-colors border-l-2 border-transparent",
        "hover:bg-background hover:border-border/50",
        isSelected && "bg-primary/[0.04] border-l-primary",
        isDragging && "z-10 opacity-50 bg-card border-border",
      )}
    >
      {/* Drag handle — discret, pro */}
      <button
        className="shrink-0 size-6 flex items-center justify-center rounded text-muted-foreground/30 opacity-0 group-hover/req:opacity-100 hover:text-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...attributes}
        {...listeners}
        tabIndex={0}
        aria-label={t("collections.row.dragLabel", { name: request.name })}
        data-testid={`drag-handle-${request.id}`}
      >
        <GripVertical className="size-3" />
      </button>

      {/* Method badge — premium 10px */}
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wide text-white border",
          methodBadge[request.method as keyof typeof methodBadge] ?? "bg-muted-foreground/30",
        )}
      >
        {request.method}
      </span>

      {/* Request name + endpoint */}
      <button className="flex-1 min-w-0 text-left group-hover/req:text-foreground transition-colors" onClick={onSelect}>
        <span className="block truncate text-[13px] font-medium leading-none text-foreground/80 group-hover/req:text-foreground">
          {request.name}
        </span>
        {request.endpoint && (
          <span className="block truncate font-mono text-[11px] leading-none text-muted-foreground/50 mt-1">
            {request.endpoint}
          </span>
        )}
      </button>

      {/* url mono hint desktop */}
      {request.endpoint && (
        <span className="hidden xl:block shrink-0 max-w-[140px] truncate font-mono text-[11px] text-muted-foreground/30">
          {request.endpoint}
        </span>
      )}

      {/* Actions — reveal on hover, premium */}
      <span className="ml-auto flex items-center gap-0.5 shrink-0 opacity-0 group-hover/req:opacity-100 transition-opacity">
        {onSend && (
          <button
            className="size-6 flex items-center justify-center rounded hover:bg-success/10 text-muted-foreground hover:text-success transition-colors"
            onClick={onSend}
            title={t("collections.row.loadAndSend")}
          >
            <PlayIcon />
          </button>
        )}
        <button
          className="size-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors"
          onClick={onRemove}
          title={t("collections.row.removeRequest")}
        >
          <TrashIcon />
        </button>
      </span>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3" aria-hidden="true">
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
      strokeWidth={1.75}
      className="size-3.5"
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
