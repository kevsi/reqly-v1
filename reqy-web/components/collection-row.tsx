"use client";

import React, { useCallback, useState } from "react";
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
  FolderOpen,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import type { TFunction } from "i18next";

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
  // Réordonner les collections (montée/descente depuis le menu)
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  // Réordonner les dossiers d'un même niveau (via le panneau)
  onFolderMoveUp?: (folderId: string) => void;
  onFolderMoveDown?: (folderId: string) => void;
}

function FolderNameModal({
  open,
  title,
  initialValue,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initialValue: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialValue);
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
          className="space-y-4"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder={t("collections.folder.namePlaceholder")}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FolderDropZone({
  collectionId,
  folder,
  isExpanded,
  children,
  folderReqCount,
  onToggleExpand,
  onRenameFolder,
  onDeleteFolder,
  onConfirmDelete,
  onFolderMoveUp,
  onFolderMoveDown,
  t,
}: {
  collectionId: string;
  folder: CollectionFolder;
  isExpanded: boolean;
  children: React.ReactNode;
  folderReqCount: number;
  onToggleExpand: (folderId: string) => void;
  onRenameFolder?: (collectionId: string, folderId: string, name: string) => void;
  onDeleteFolder?: (collectionId: string, folderId: string) => void;
  onConfirmDelete: (label: string, onConfirm: () => void) => void;
  onFolderMoveUp?: (folderId: string) => void;
  onFolderMoveDown?: (folderId: string) => void;
  t: TFunction<"translation">;
}) {
  const { setNodeRef: folderDropRef, isOver } = useDroppable({
    id: folderDropId(collectionId, folder.id),
    data: { type: "folder" as const, collectionId, folderId: folder.id },
  });
  const [renameOpen, setRenameOpen] = useState(false);
  return (
    <div
      ref={folderDropRef}
      data-testid={`folder-drop-${folder.name}`}
      className={cn("relative rounded-sm transition-colors", isOver && "bg-primary/[0.08]")}
    >
      {/* ── Folder header ── */}
      <div
        className={cn(
          "flex items-center gap-2 pl-11 pr-4 py-2 mt-1 rounded-md transition-all duration-150",
          "bg-muted/[0.06] border border-border/20 hover:bg-muted/[0.12] hover:border-border/30",
          isExpanded && "bg-muted/[0.12] border-border/30",
          isOver && "bg-primary/[0.10] border-primary/30",
        )}
      >
        <button
          onClick={() => onToggleExpand(folder.id)}
          className="shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <span className="shrink-0 text-primary/60">
          {isExpanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
        </span>

        <span
          className="flex-1 min-w-0 text-sm font-medium text-foreground/80 truncate cursor-pointer"
          onClick={() => onToggleExpand(folder.id)}
        >
          {folder.name}
        </span>

        <span className="shrink-0 text-xs font-mono text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded">
          {folderReqCount}
        </span>

        {/* Folder actions */}
        <div className="ml-auto flex items-center gap-1">
          {onRenameFolder && (
            <button
              type="button"
              title={t("collections.row.renameFolder")}
              onClick={(e) => {
                e.stopPropagation();
                setRenameOpen(true);
              }}
              className="size-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-all"
            >
              <Edit2 className="size-3" />
            </button>
          )}
          {onFolderMoveUp && (
            <button
              type="button"
              title={t("collections.row.moveUp")}
              onClick={(e) => {
                e.stopPropagation();
                onFolderMoveUp(folder.id);
              }}
              className="size-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-all"
            >
              <ArrowUp className="size-3" />
            </button>
          )}
          {onFolderMoveDown && (
            <button
              type="button"
              title={t("collections.row.moveDown")}
              onClick={(e) => {
                e.stopPropagation();
                onFolderMoveDown(folder.id);
              }}
              className="size-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-all"
            >
              <ArrowDown className="size-3" />
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
                  () => onDeleteFolder(collectionId, folder.id),
                );
              }}
              className="size-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Folder content (expanded) ── */}
      {isExpanded && (
        <div className="relative pr-1 py-1 space-y-0.5">
          {/* Left border indicator — aligned with nested request padding (depth 1) */}
          <div className="absolute left-0 top-0 bottom-0 w-0.5 ml-11 rounded-r bg-border/20" />
          {children}
        </div>
      )}

      <FolderNameModal
        open={renameOpen}
        title={t("collections.row.renameFolder")}
        initialValue={folder.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => {
          onRenameFolder?.(collectionId, folder.id, name);
          setRenameOpen(false);
        }}
      />
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
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onFolderMoveUp,
  onFolderMoveDown,
}: CollectionRowProps) {
  const { t } = useTranslation();

  // ── Track expanded folders ──
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const toggleFolderExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  // ── Droppable for cross-collection moves ──
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: collectionDropId(collection.id),
    data: { type: "collection" as const, collectionId: collection.id },
  });
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [pendingRemoveRequest, setPendingRemoveRequest] = useState<RequestItem | null>(null);

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

    // Root-level requests first (with light visual distinction)
    if (rootReqs.length > 0) {
      result.push(
        <div key="__root__-section" className="space-y-0.5">
          {rootReqs.map((req) => (
            <DraggableRequestRow
              key={req.id}
              request={req}
              collectionId={collection.id}
              isSelected={selectedRequestIds.has(`${collection.id}::${req.id}`)}
              onSelect={() => onSelectRequest(req)}
              onSend={onSelectAndSendRequest ? () => onSelectAndSendRequest(req) : undefined}
              onRemove={() => setPendingRemoveRequest(req)}
              depth={0}
            />
          ))}
        </div>,
      );
    }

    // Folder sections
    for (const folder of folders) {
      const folderReqs = folderMap.get(folder.id) ?? [];
      const isFolderExpanded = expandedFolderIds.has(folder.id);
      result.push(
        <FolderDropZone
          key={`fld-${folder.id}`}
          collectionId={collection.id}
          folder={folder}
          isExpanded={isFolderExpanded}
          folderReqCount={folderReqs.length}
          onToggleExpand={toggleFolderExpand}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onConfirmDelete={onConfirmDelete}
          onFolderMoveUp={onFolderMoveUp}
          onFolderMoveDown={onFolderMoveDown}
          t={t}
        >
          {folderReqs.map((req) => (
            <DraggableRequestRow
              key={req.id}
              request={req}
              collectionId={collection.id}
              isSelected={selectedRequestIds.has(`${collection.id}::${req.id}`)}
              onSelect={() => onSelectRequest(req)}
              onSend={onSelectAndSendRequest ? () => onSelectAndSendRequest(req) : undefined}
              onRemove={() => setPendingRemoveRequest(req)}
              depth={1}
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
    onConfirmDelete,
    onDeleteFolder,
    onRenameFolder,
    onFolderMoveUp,
    onFolderMoveDown,
    expandedFolderIds,
    toggleFolderExpand,
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
                <DropdownMenuItem onClick={() => setCreateFolderOpen(true)}>
                  <Folder className="mr-2 size-3.5" /> {t("collections.row.addFolder")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onRenameStart(collection.id, collection.name)}>
                <Edit2 className="mr-2 size-3.5" /> {t("collections.row.rename")}
              </DropdownMenuItem>
              {onMoveUp && (
                <DropdownMenuItem onClick={onMoveUp} disabled={!canMoveUp}>
                  <ArrowUp className="mr-2 size-3.5" /> {t("collections.row.moveUp")}
                </DropdownMenuItem>
              )}
              {onMoveDown && (
                <DropdownMenuItem onClick={onMoveDown} disabled={!canMoveDown}>
                  <ArrowDown className="mr-2 size-3.5" /> {t("collections.row.moveDown")}
                </DropdownMenuItem>
              )}
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
                    onRemove={() => setPendingRemoveRequest(req)}
                    depth={1}
                  />
                ))}
          </SortableContext>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRemoveRequest}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveRequest(null);
        }}
        title={t("collections.removeRequestTitle")}
        description={t("collections.removeRequestDescription", {
          name: pendingRemoveRequest?.name,
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingRemoveRequest) onRemoveRequest(collection.id, pendingRemoveRequest.id);
          setPendingRemoveRequest(null);
        }}
      />

      <FolderNameModal
        open={createFolderOpen}
        title={t("collections.row.addFolder")}
        initialValue=""
        onClose={() => setCreateFolderOpen(false)}
        onSubmit={(name) => {
          onAddFolder?.(collection.id, name, null);
          setCreateFolderOpen(false);
        }}
      />
    </div>
  );
}
