"use client";

import React, { useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Package,
  Trash2,
  Edit2,
  Download,
  CheckSquare,
  Square,
  Copy,
  Play,
  Folder,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Collection, CollectionFolder, RequestItem } from "@/hooks/request-types";
import { collectionColors, collectionIcons, safeColor } from "@/lib/collection-utils";

import { DraggableRequestRow } from "@/components/drag-and-drop/draggable-request-row";
import { collectionDropId, requestId, folderDropId } from "@/hooks/use-request-dnd";
import { useTranslation } from "react-i18next";

interface CollectionRowProps {
  collection: Collection;
  isExpanded: boolean;
  isSelected: boolean;
  editingCollectionId: string | null;
  renameValue: string;
  selectedRequestIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectRequest: (colId: string, reqId: string) => void;
  onSelectRequest: (req: RequestItem) => void;
  onSelectAndSendRequest?: (req: RequestItem) => void;
  onRenameStart: (id: string, currentName: string) => void;
  onRenameConfirm: (id: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCancel: () => void;
  onAddRequest: (collectionId: string) => void;
  onExportCollection: (collection: Collection) => void;
  onDuplicateCollection?: (id: string) => void;
  onRunCollection?: (collection: Collection) => void;
  onConfirmDelete: (label: string, onConfirm: () => void) => void;
  onDeleteCollection: (id: string) => void;
  onRemoveRequest: (collectionId: string, requestId: string) => void;
  onMoveRequestToFolder?: (
    collectionId: string,
    requestId: string,
    folderId: string | null,
  ) => void;
  // Folder CRUD operations
  onAddFolder?: (collectionId: string, name: string, parentId: string | null) => string;
  onRenameFolder?: (collectionId: string, folderId: string, name: string) => void;
  onDeleteFolder?: (collectionId: string, folderId: string) => void;
  onMoveFolder?: (collectionId: string, folderId: string, newParentId: string | null) => void;
}

function FolderDropZone({
  collectionId,
  folder,
  children,
}: {
  collectionId: string;
  folder: CollectionFolder;
  children: React.ReactNode;
}) {
  const { setNodeRef: folderDropRef, isOver } = useDroppable({
    id: folderDropId(collectionId, folder.id),
    data: { type: "folder" as const, collectionId, folderId: folder.id },
  });
  return (
    <div
      ref={folderDropRef}
      data-testid={`folder-drop-${folder.name}`}
      className={cn(
        "relative",
        isOver && "bg-primary/[0.04]",
        isOver &&
          "before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-r before:bg-primary/60",
      )}
    >
      {children}
    </div>
  );
}

export function CollectionRow({
  collection,
  isExpanded,
  isSelected,
  editingCollectionId,
  renameValue,
  selectedRequestIds,
  onToggleExpand,
  onToggleSelect,
  onSelectRequest,
  onSelectAndSendRequest,
  onRenameStart,
  onRenameConfirm,
  onRenameChange,
  onRenameCancel,
  onAddRequest,
  onExportCollection,
  onDuplicateCollection,
  onRunCollection,
  onConfirmDelete,
  onDeleteCollection,
  onRemoveRequest,
  onMoveRequestToFolder: _onMoveRequestToFolder,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder: _onMoveFolder,
}: CollectionRowProps) {
  const { t } = useTranslation();
  // ── Droppable for cross-collection moves ──
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: collectionDropId(collection.id),
    data: { type: "collection" as const, collectionId: collection.id },
  });

  // ── Sortable request IDs ──
  const requestIds = collection.requests.map((r) => requestId(r.id));

  const renderRequestsByFolder = useCallback(() => {
    const folders = collection.folders ?? [];
    const folderMap = new Map<string | null, RequestItem[]>();
    for (const req of collection.requests) {
      const key = req.folderId ?? "__root__";
      if (!folderMap.has(key)) folderMap.set(key, []);
      folderMap.get(key)!.push(req);
    }
    const rootReqs = folderMap.get("__root__") ?? [];
    const result: React.ReactNode[] = [];

    // Root-level requests first
    for (const req of rootReqs) {
      result.push(
        <DraggableRequestRow
          key={req.id}
          request={req}
          collectionId={collection.id}
          isSelected={selectedRequestIds.has(`${collection.id}::${req.id}`)}
          onSelect={() => onSelectRequest(req)}
          onSend={onSelectAndSendRequest ? () => onSelectAndSendRequest(req) : undefined}
          onRemove={() => onRemoveRequest(collection.id, req.id)}
        />,
      );
    }

    // Folder sections
    for (const folder of folders) {
      const folderReqs = folderMap.get(folder.id) ?? [];
      result.push(
        <FolderDropZone key={`fld-${folder.id}`} collectionId={collection.id} folder={folder}>
          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/10 border-b border-border/10">
            <Folder className="size-3 text-muted-foreground/60" />
            <span className="text-xs font-medium text-muted-foreground/80">{folder.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground/40">
              ({folderReqs.length})
            </span>
            {/* Folder actions */}
            <div className="ml-auto flex items-center gap-0.5">
              {onRenameFolder && (
                <button
                  type="button"
                  title={t("collections.row.renameFolder")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const newName = window.prompt(t("collections.row.newFolderName"), folder.name);
                    if (newName && newName.trim()) {
                      onRenameFolder(collection.id, folder.id, newName.trim());
                    }
                  }}
                  className="size-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent"
                >
                  <Edit2 className="size-3" />
                </button>
              )}
              {onDeleteFolder && (
                <button
                  type="button"
                  title={t("collections.row.deleteFolder")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmDelete(
                      t("collections.row.deleteFolderConfirm", { name: folder.name }),
                      () => onDeleteFolder(collection.id, folder.id),
                    );
                  }}
                  className="size-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          </div>
          {folderReqs.map((req) => (
            <DraggableRequestRow
              key={req.id}
              request={req}
              collectionId={collection.id}
              isSelected={selectedRequestIds.has(`${collection.id}::${req.id}`)}
              onSelect={() => onSelectRequest(req)}
              onSend={onSelectAndSendRequest ? () => onSelectAndSendRequest(req) : undefined}
              onRemove={() => onRemoveRequest(collection.id, req.id)}
            />
          ))}
        </FolderDropZone>,
      );
    }

    return result;
  }, [
    collection,
    selectedRequestIds,
    onSelectRequest,
    onSelectAndSendRequest,
    onRemoveRequest,
    onConfirmDelete,
    onDeleteFolder,
    onRenameFolder,
    t,
  ]);

  return (
    <div
      ref={dropRef}
      data-testid="collection-row"
      className={cn(
        "relative",
        isOver && "bg-primary/[0.04]",
        isOver &&
          "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-r before:bg-primary/60",
      )}
    >
      {/* ── Collection header ── */}
      <div className={cn("flex items-center gap-3 px-3 py-2.5", isSelected && "bg-primary/[0.03]")}>
        <button
          onClick={() => onToggleSelect(collection.id)}
          className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground/60"
        >
          {isSelected ? (
            <CheckSquare className="size-3.5 text-primary" />
          ) : (
            <Square className="size-3.5" />
          )}
        </button>
        <button
          onClick={() => onToggleExpand(collection.id)}
          className="shrink-0 text-muted-foreground/50"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded",
            collectionColors[safeColor(collection.color)],
          )}
        >
          {collectionIcons[collection.icon] ?? <Package className="size-2.5 text-white" />}
        </span>
        {editingCollectionId === collection.id ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Input
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRenameConfirm(collection.id);
                }
                if (e.key === "Escape") onRenameCancel();
              }}
              autoFocus
              className="h-7 text-sm w-48"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRenameConfirm(collection.id)}
              className="h-7 px-2 text-xs font-medium text-primary"
            >
              OK
            </Button>
          </div>
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-sm font-medium text-foreground/90 cursor-pointer"
            onClick={() => onToggleExpand(collection.id)}
          >
            {collection.name}
          </span>
        )}
        <Badge
          variant="outline"
          className="shrink-0 text-[10px] px-1.5 py-0 h-4 font-mono text-muted-foreground/60 border-muted-foreground/20"
        >
          {collection.requests.length}
        </Badge>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="size-6 flex items-center justify-center rounded text-muted-foreground/30 hover:text-foreground hover:bg-accent">
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onAddRequest(collection.id)}>
                <Plus className="mr-2 size-3.5" /> {t("collections.row.addRequest")}
              </DropdownMenuItem>
              {onAddFolder && (
                <DropdownMenuItem
                  onClick={() => {
                    const name = window.prompt(t("collections.row.folderName"));
                    if (name && name.trim()) {
                      onAddFolder(collection.id, name.trim(), null);
                    }
                  }}
                >
                  <Folder className="mr-2 size-3.5" /> {t("collections.row.addFolder")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onRenameStart(collection.id, collection.name)}>
                <Edit2 className="mr-2 size-3.5" /> {t("collections.row.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExportCollection(collection)}>
                <Download className="mr-2 size-3.5" /> {t("collections.row.export")}
              </DropdownMenuItem>
              {onDuplicateCollection && (
                <DropdownMenuItem onClick={() => onDuplicateCollection(collection.id)}>
                  <Copy className="mr-2 size-3.5" /> {t("collections.row.duplicate")}
                </DropdownMenuItem>
              )}
              {onRunCollection && (
                <DropdownMenuItem onClick={() => onRunCollection(collection)}>
                  <Play className="mr-2 size-3.5" /> {t("collections.row.runAll")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  onConfirmDelete(
                    t("collections.row.deleteCollection", { name: collection.name }),
                    () => onDeleteCollection(collection.id),
                  )
                }
                className="text-destructive"
              >
                <Trash2 className="mr-2 size-3.5" /> {t("collections.row.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Expanded requests (grouped by folder if folders exist) ── */}
      {isExpanded && collection.requests.length > 0 && (
        <div className="border-t border-border/20">
          <SortableContext items={requestIds} strategy={verticalListSortingStrategy}>
            {collection.folders && collection.folders.length > 0
              ? renderRequestsByFolder()
              : collection.requests.map((req) => (
                  <DraggableRequestRow
                    key={req.id}
                    request={req}
                    collectionId={collection.id}
                    isSelected={selectedRequestIds.has(`${collection.id}::${req.id}`)}
                    onSelect={() => onSelectRequest(req)}
                    onSend={onSelectAndSendRequest ? () => onSelectAndSendRequest(req) : undefined}
                    onRemove={() => onRemoveRequest(collection.id, req.id)}
                  />
                ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
