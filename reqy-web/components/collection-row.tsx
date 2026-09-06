"use client";

import React, { useCallback, useState, useMemo } from "react";
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
  Clock,
  FileJson,
  FolderDown,
  FileCode,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";

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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import type { Collection, CollectionFolder, RequestItem } from "@/hooks/request-types";
import { collectionColors, collectionIcons, safeColor, collectionAccent } from "@/lib/collection-utils";

import { DraggableRequestRow } from "@/components/drag-and-drop/draggable-request-row";
import { collectionDropId, requestId, folderDropId } from "@/hooks/use-request-dnd";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { methodDot } from "@/lib/http-method-colors";

const ROW_KEYS = {
  newBadge: "collections.panel.newBadge",
} as const;

interface CollectionRowProps {
  collection: Collection;
  isHighlighted?: boolean;
  showNewBadge?: boolean;
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
  onAddRequest: (collectionId: string, folderId?: string | null) => void;
  onExportCollection: (collection: Collection, format: "json" | "bruno" | "opencollection") => void;
  onDuplicateCollection?: (id: string) => void;
  onRunCollection?: (collection: Collection) => void;
  onConfirmDelete: (label: string, onConfirm: () => void) => void;
  onDeleteCollection: (id: string) => void;
  onRemoveRequest: (collectionId: string, requestId: string) => void;
  onMoveRequestToFolder?: (collectionId: string, requestId: string, folderId: string | null) => void;
  onAddFolder?: (collectionId: string, name: string, parentId: string | null) => string;
  onRenameFolder?: (collectionId: string, folderId: string, name: string) => void;
  onDeleteFolder?: (collectionId: string, folderId: string) => void;
  onMoveFolder?: (collectionId: string, folderId: string, newParentId: string | null) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
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
  React.useEffect(() => {
    if (open) setName(initialValue);
  }, [open, initialValue]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
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
            className="h-8 text-sm"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()} className="h-7 text-xs">
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Premium FolderDropZone : explorer VSCode-like ──
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
  onAddFolder,
  onAddRequest,
  depth = 0,
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
  onAddFolder?: (collectionId: string, name: string, parentId: string | null) => string;
  onAddRequest?: (collectionId: string, folderId?: string | null) => void;
  depth?: number;
  t: TFunction<"translation">;
}) {
  const { setNodeRef: folderDropRef, isOver } = useDroppable({
    id: folderDropId(collectionId, folder.id),
    data: { type: "folder" as const, collectionId, folderId: folder.id },
  });
  const [renameOpen, setRenameOpen] = useState(false);
  const [createSubOpen, setCreateSubOpen] = useState(false);
  // Indentation hiérarchique : 14px par niveau (réduit pour sous-dossiers)
  const indentPx = depth * 14;

  return (
    <div ref={folderDropRef} data-testid={`folder-drop-${folder.name}`} className={cn(isOver && "bg-primary/5")}>
      <div
        style={{ paddingLeft: `${6 + indentPx}px` }}
        className={cn(
          "group/folder flex items-center gap-1.5 py-1.5 pr-2 text-sm hover:bg-muted/40 transition-colors",
          isOver && "bg-primary/10",
        )}
      >
        <button
          onClick={() => onToggleExpand(folder.id)}
          className="shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <span className="shrink-0 text-muted-foreground">
          {isExpanded ? <FolderOpen className="size-3.5" /> : <Folder className="size-3.5" />}
        </span>
        <span
          className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground/80 cursor-pointer hover:text-foreground transition-colors"
          onClick={() => onToggleExpand(folder.id)}
        >
          {folder.name}
        </span>
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[11px] tabular-nums leading-none text-muted-foreground">
          {folderReqCount}
        </span>
        <div className="ml-auto flex items-center gap-0 opacity-0 group-hover/folder:opacity-100 transition-opacity">
          {onAddFolder && onAddRequest && (
            <button
              type="button"
              title={t("collections.row.addRequestInFolder", { defaultValue: "Ajouter une requête dans ce dossier" })}
              onClick={(e) => {
                e.stopPropagation();
                onAddRequest(collectionId, folder.id);
                if (!isExpanded) onToggleExpand(folder.id);
              }}
              className="size-6 flex items-center justify-center rounded bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <Plus className="size-3" />
            </button>
          )}
          {onAddFolder && (
            <button
              type="button"
              title={t("collections.row.addSubfolder", { defaultValue: "Ajouter un sous-dossier" })}
              onClick={(e) => {
                e.stopPropagation();
                setCreateSubOpen(true);
              }}
              className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="size-3" />
            </button>
          )}
          {onRenameFolder && (
            <button
              type="button"
              title={t("collections.row.renameFolder")}
              onClick={(e) => {
                e.stopPropagation();
                setRenameOpen(true);
              }}
              className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
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
              className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
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
              className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
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
              className="size-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="ml-2 border-l border-border/30 pl-2 space-y-0">
          {React.Children.count(children) > 0 ? (
            children
          ) : (
            <div className="flex items-center gap-2 py-1.5 text-[11px] text-muted-foreground/60">
              <span>{t("collections.folder.empty", { defaultValue: "Dossier vide" })}</span>
              {onAddRequest && (
                <button
                  type="button"
                  onClick={() => {
                    onAddRequest(collectionId, folder.id);
                    // reste ouvert
                  }}
                  className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  <Plus className="size-3" />
                  {t("collections.row.addRequest", { defaultValue: "Ajouter" })}
                </button>
              )}
            </div>
          )}
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
      <FolderNameModal
        open={createSubOpen}
        title={t("collections.row.addSubfolder", { defaultValue: "Nouveau sous-dossier" })}
        initialValue=""
        onClose={() => setCreateSubOpen(false)}
        onSubmit={(name) => {
          onAddFolder?.(collectionId, name, folder.id);
          setCreateSubOpen(false);
        }}
      />
    </div>
  );
}

export function CollectionRow({
  collection,
  isHighlighted = false,
  showNewBadge = false,
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
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const toggleFolderExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: collectionDropId(collection.id),
    data: { type: "collection" as const, collectionId: collection.id },
  });
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [pendingRemoveRequest, setPendingRemoveRequest] = useState<RequestItem | null>(null);
  const requestIds = collection.requests.map((r) => requestId(r.id));

  // Premium: method mix preview (max 4 dots)
  const methodPreview = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of collection.requests) counts.set(r.method, (counts.get(r.method) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [collection.requests]);

  const renderRequestsByFolder = useCallback(() => {
    const folders = [...(collection.folders ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const sortedRequests = [...collection.requests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const folderMap = new Map<string, RequestItem[]>();
    for (const req of sortedRequests) {
      const key = req.folderId ?? "__root__";
      if (!folderMap.has(key)) folderMap.set(key, []);
      folderMap.get(key)!.push(req);
    }
    const childrenMap = new Map<string | null, CollectionFolder[]>();
    for (const f of folders) {
      const parent = f.parentId ?? null;
      if (!childrenMap.has(parent)) childrenMap.set(parent, []);
      childrenMap.get(parent)!.push(f);
    }
    const rootReqs = folderMap.get("__root__") ?? [];
    const result: React.ReactNode[] = [];
    if (rootReqs.length > 0) {
      result.push(
        <div key="__root__-section" className="space-y-0">
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
    const renderFolder = (folder: CollectionFolder, depth: number): React.ReactNode => {
      const folderReqs = folderMap.get(folder.id) ?? [];
      const isFolderExpanded = expandedFolderIds.has(folder.id);
      const childFolders = childrenMap.get(folder.id) ?? [];
      return (
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
          onAddFolder={onAddFolder}
          onAddRequest={onAddRequest}
          depth={depth}
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
              depth={depth + 1}
            />
          ))}
          {childFolders.map((child) => renderFolder(child, depth + 1))}
        </FolderDropZone>
      );
    };
    const rootFolders = childrenMap.get(null) ?? [];
    for (const folder of rootFolders) {
      result.push(renderFolder(folder, 0));
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
    onAddFolder,
    onAddRequest,
    expandedFolderIds,
    toggleFolderExpand,
    t,
  ]);

  const accentClass = collectionAccent[safeColor(collection.color)] ?? "bg-primary";

  return (
    <div
      ref={dropRef}
      data-testid="collection-row"
      data-collection-id={collection.id}
      className={cn(
        "relative border-l-2 bg-card transition-colors",
        isSelected ? "bg-primary/[0.03] border-l-primary" : "border-l-transparent",
        isOver && "bg-primary/5 border-l-primary",
        isHighlighted && "ring-1 ring-primary ring-inset z-10",
      )}
      style={!isSelected && !isOver ? { borderLeftColor: isExpanded ? "hsl(var(--border))" : "transparent" } : undefined}
    >
      {/* accent line subtle — couleur collection en 2px interne */}
      {!isSelected && !isOver && (
        <span className={cn("absolute left-0 top-0 bottom-0 w-0.5 opacity-60", accentClass)} aria-hidden />
      )}

      {/* Header — premium 56px */}
      <div className={cn("group flex items-center gap-2 px-2.5 py-2.5 hover:bg-muted/30 transition-colors", isSelected && "bg-primary/5")}>
        <button
          onClick={() => onToggleSelect(collection.id)}
          className="shrink-0 flex size-5 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
          aria-label="Select collection"
        >
          {isSelected ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4" />}
        </button>

        <button
          onClick={() => onToggleExpand(collection.id)}
          className="shrink-0 flex size-6 items-center justify-center rounded bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>

        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-white",
            collectionColors[safeColor(collection.color)],
          )}
        >
          {collectionIcons[collection.icon] ?? <Package className="size-3.5 text-white" />}
        </span>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {editingCollectionId === collection.id ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Input
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRenameConfirm(collection.id);
                  if (e.key === "Escape") onRenameCancel();
                }}
                autoFocus
                className="h-7 text-sm w-56"
              />
              <Button variant="ghost" size="sm" onClick={() => onRenameConfirm(collection.id)} className="h-7 px-2 text-xs font-medium text-primary">
                OK
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="truncate text-[13px] font-semibold tracking-tight text-foreground cursor-pointer hover:text-primary transition-colors"
                  onClick={() => onToggleExpand(collection.id)}
                >
                  {collection.name}
                </span>
                {showNewBadge && (
                  <span className="shrink-0 inline-flex items-center rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
                    {t(ROW_KEYS.newBadge, { defaultValue: "Nouveau" })}
                  </span>
                )}
                {/* method mix dots — premium hint */}
                {methodPreview.length > 0 && !isExpanded && (
                  <span className="hidden sm:flex items-center gap-1 shrink-0">
                    {methodPreview.map(([m]) => (
                      <span key={m} className={cn("size-1.5 rounded-full", methodDot[m as keyof typeof methodDot] ?? "bg-muted-foreground/30")} />
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] leading-none text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="tabular-nums font-medium text-foreground/70">{collection.requests.length}</span>
                  <span>req</span>
                </span>
                {collection.folders && collection.folders.length > 0 && (
                  <>
                    <span className="size-1 rounded-full bg-border" />
                    <span className="tabular-nums">{collection.folders.length} dossiers</span>
                  </>
                )}
                {collection.updatedAt && (
                  <>
                    <span className="size-1 rounded-full bg-border hidden sm:inline-flex" />
                    <span className="hidden sm:inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {new Date(collection.updatedAt).toLocaleDateString()}
                    </span>
                  </>
                )}
              </div>
              {collection.description && isExpanded && (
                <p className="truncate text-[11px] leading-relaxed text-muted-foreground/80">{collection.description}</p>
              )}
            </>
          )}
        </div>

        {/* Actions — premium, apparition au hover */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="hidden lg:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onAddRequest(collection.id)}
              title={t("collections.row.addRequest")}
              className="size-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
            {onRunCollection && (
              <button
                onClick={() => onRunCollection(collection)}
                title={t("collections.row.runAll")}
                className="size-7 flex items-center justify-center rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
              >
                <Play className="size-3.5" />
              </button>
            )}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="size-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
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
              <DropdownMenuSeparator />
              {onMoveUp && (
                <DropdownMenuItem onClick={onMoveUp} disabled={!canMoveUp} className="text-xs">
                  <ArrowUp className="mr-2 size-3.5" /> {t("collections.row.moveUp")}
                </DropdownMenuItem>
              )}
              {onMoveDown && (
                <DropdownMenuItem onClick={onMoveDown} disabled={!canMoveDown} className="text-xs">
                  <ArrowDown className="mr-2 size-3.5" /> {t("collections.row.moveDown")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className="flex items-center gap-2">
                    <Download className="size-3.5" /> {t("collections.row.export")}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onExportCollection(collection, "json")}>
                    <FileJson className="mr-2 size-3.5" /> {t("collections.row.exportJson")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExportCollection(collection, "bruno")}>
                    <FolderDown className="mr-2 size-3.5" /> {t("collections.row.exportBruno")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExportCollection(collection, "opencollection")}>
                    <FileCode className="mr-2 size-3.5" /> {t("collections.row.exportOpenCollection")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  onConfirmDelete(t("collections.row.deleteCollection", { name: collection.name }), () =>
                    onDeleteCollection(collection.id),
                  )
                }
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-3.5" /> {t("collections.row.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded && (collection.requests.length > 0 || (collection.folders && collection.folders.length > 0)) && (
        <div className="border-t border-border/40 bg-muted/20">
          {/* Indentation visuelle : contenu à l'intérieur — dossiers et requêtes alignés */}
          <div className="ml-[32px] border-l border-border/40">
            <SortableContext items={requestIds} strategy={verticalListSortingStrategy}>
              {collection.folders && collection.folders.length > 0 ? (
                <div className="py-1">{renderRequestsByFolder()}</div>
              ) : (
                <div className="py-1">
                  {collection.requests.map((req) => (
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
                </div>
              )}
            </SortableContext>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRemoveRequest}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveRequest(null);
        }}
        title={t("collections.removeRequestTitle")}
        description={t("collections.removeRequestDescription", { name: pendingRemoveRequest?.name })}
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
