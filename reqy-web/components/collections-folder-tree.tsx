"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderOpen,
  MoreHorizontal,
  Trash2,
  Edit2,
  GripVertical,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Collection, CollectionFolder, RequestItem } from "@/hooks/use-request-store";
import { getTotalCount } from "@/lib/tree-utils";
import { usePersistedSet } from "@/hooks/use-persisted-set";
import { RequestTreeItem } from "@/components/collections-request-tree-item";

const COLLAPSE_KEY = "reqly-folder-collapse";

function renderFolderTree(
  parentId: string | null,
  depth: number,
  folders: CollectionFolder[],
  renderFolderOption: (folder: CollectionFolder, depth: number) => React.ReactNode,
): React.ReactNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .flatMap((folder) => [
      renderFolderOption(folder, depth),
      ...renderFolderTree(folder.id, depth + 1, folders, renderFolderOption),
    ]);
}

interface CollectionsFolderTreeProps {
  collection: Collection;
  folders: CollectionFolder[];
  requests: RequestItem[];
  selectedRequestIds: Set<string>;
  onToggleSelectRequest: (collectionId: string, requestId: string) => void;
  onSelectRequest: (request: RequestItem) => void;
  onSelectAndSendRequest?: (request: RequestItem) => void;
  onRemoveRequestFromCollection: (collectionId: string, requestId: string) => void;
  onAddFolder: (collectionId: string, name: string, parentId: string | null) => string;
  onRenameFolder: (collectionId: string, folderId: string, name: string) => void;
  onDeleteFolder: (collectionId: string, folderId: string) => void;
  onMoveRequestToFolder: (collectionId: string, requestId: string, folderId: string | null) => void;
  onMoveFolder?: (collectionId: string, folderId: string, newParentId: string | null) => void;
  onReorderRequests?: (
    collectionId: string,
    folderId: string | null,
    orderedRequestIds: string[],
  ) => void;
  onReorderFolders?: (
    collectionId: string,
    parentFolderId: string | null,
    orderedFolderIds: string[],
  ) => void;
  confirmDelete: (label: string, onConfirm: () => void) => void;
}

export function CollectionsFolderTree({
  collection,
  folders,
  requests,
  selectedRequestIds,
  onToggleSelectRequest,
  onSelectRequest,
  onSelectAndSendRequest,
  onRemoveRequestFromCollection,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveRequestToFolder,
  onMoveFolder,
  onReorderRequests,
  onReorderFolders,
  confirmDelete,
}: CollectionsFolderTreeProps) {
  const { t } = useTranslation();
  const colId = collection.id;

  const [expandedFolders, setExpandedFolders] = usePersistedSet(COLLAPSE_KEY, colId);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [movingRequestId, setMovingRequestId] = useState<string | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);

  // ── Drag-to-reorder state ──
  const [dragRequestId, setDragRequestId] = useState<string | null>(null);
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [dragHoverFolderId, setDragHoverFolderId] = useState<string | null>(null);
  const dragOverFolderIdRef = useRef<string | null>(null);

  // Clear folder hover indicator when request drag ends
  useEffect(() => {
    if (!dragRequestId) setDragHoverFolderId(null);
  }, [dragRequestId]);

  const toggleFolder = useCallback(
    (folderId: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return next;
      });
    },
    [setExpandedFolders],
  );

  const handleCreateFolder = useCallback((parentId: string | null = null) => {
    setCreateParentId(parentId);
    setNewFolderName("");
    setCreateDialogOpen(true);
  }, []);

  const handleConfirmCreate = useCallback(() => {
    if (newFolderName.trim()) {
      onAddFolder(collection.id, newFolderName.trim(), createParentId);
    }
    setCreateDialogOpen(false);
    setNewFolderName("");
  }, [newFolderName, createParentId, onAddFolder, collection.id]);

  const handleStartRename = useCallback((folderId: string, currentName: string) => {
    setEditingFolderId(folderId);
    setRenameValue(currentName);
  }, []);

  const handleConfirmRename = useCallback(
    (folderId: string) => {
      if (renameValue.trim()) {
        onRenameFolder(collection.id, folderId, renameValue.trim());
      }
      setEditingFolderId(null);
    },
    [renameValue, onRenameFolder, collection.id],
  );

  const handleStartMove = useCallback((requestId: string) => {
    setMovingRequestId(requestId);
    setMovingFolderId(null);
    setMoveDialogOpen(true);
  }, []);

  const handleStartMoveFolder = useCallback((folderId: string) => {
    setMovingFolderId(folderId);
    setMovingRequestId(null);
    setMoveDialogOpen(true);
  }, []);

  const handleConfirmMove = useCallback(
    (targetFolderId: string | null) => {
      if (movingRequestId) {
        onMoveRequestToFolder(collection.id, movingRequestId, targetFolderId);
      }
      if (movingFolderId && onMoveFolder) {
        onMoveFolder(collection.id, movingFolderId, targetFolderId);
      }
      setMoveDialogOpen(false);
      setMovingRequestId(null);
      setMovingFolderId(null);
    },
    [movingRequestId, movingFolderId, onMoveRequestToFolder, onMoveFolder, collection.id],
  );

  // Memoized hierarchy helpers
  const rootFolders = useMemo(() => folders.filter((f) => f.parentId === null), [folders]);

  const childFolders = useCallback(
    (parentId: string) => folders.filter((f) => f.parentId === parentId),
    [folders],
  );

  const requestsInFolder = useCallback(
    (folderId: string) => requests.filter((r) => r.folderId === folderId),
    [requests],
  );

  const rootRequests = useMemo(() => requests.filter((r) => !r.folderId), [requests]);

  const getDropTargetFolderId = useCallback(() => dragOverFolderIdRef.current, []);

  const renderRequest = useCallback(
    (
      request: RequestItem,
      depth: number = 0,
      isLastSibling: boolean = true,
      stems: number[] = [],
    ) => {
      const reqKey = `${collection.id}::${request.id}`;
      return (
        <RequestTreeItem
          key={request.id}
          request={request}
          collectionId={collection.id}
          collectionName={collection.name}
          depth={depth}
          isLastSibling={isLastSibling}
          stems={stems}
          isSelected={selectedRequestIds.has(reqKey)}
          isDragging={dragRequestId === request.id}
          allRequests={requests}
          onToggleSelect={onToggleSelectRequest}
          onSelect={onSelectRequest}
          onSelectAndSend={onSelectAndSendRequest}
          onRemove={onRemoveRequestFromCollection}
          onStartMove={handleStartMove}
          onConfirmDelete={confirmDelete}
          onReorder={onReorderRequests}
          onDragStateChange={setDragRequestId}
          getDropTargetFolderId={getDropTargetFolderId}
          onMoveToFolder={(reqId, fId) => onMoveRequestToFolder(collection.id, reqId, fId)}
          onClearFolderDropTarget={() => {
            dragOverFolderIdRef.current = null;
          }}
        />
      );
    },
    [
      collection.id,
      collection.name,
      selectedRequestIds,
      onToggleSelectRequest,
      onSelectRequest,
      onSelectAndSendRequest,
      onRemoveRequestFromCollection,
      handleStartMove,
      confirmDelete,
      onReorderRequests,
      onMoveRequestToFolder,
      dragRequestId,
      requests,
      getDropTargetFolderId,
    ],
  );

  const renderFolder = useCallback(
    function renderFolder(
      folder: CollectionFolder,
      depth: number = 0,
      isLastSibling: boolean = true,
      stems: number[] = [],
    ) {
      const isExpanded = expandedFolders.has(folder.id);
      const children = childFolders(folder.id);
      const folderRequests = requestsInFolder(folder.id);
      const hasContent = children.length > 0 || folderRequests.length > 0;
      const indent = depth * 20;
      const isRoot = depth === 0;

      return (
        <div key={folder.id} className="relative">
          {/* Connector tree lines from ancestor levels */}
          {stems.map((sd) => (
            <span
              key={sd}
              className="absolute left-0 top-0 h-full w-px bg-border/40"
              style={{ left: `${sd * 20 + 6}px` }}
            />
          ))}
          {/* Horizontal branch + vertical stem for current level */}
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

          <div
            className={cn(
              "group relative flex items-center transition-all duration-150",
              isRoot
                ? "rounded-lg px-2 py-2 bg-muted/[0.03] hover:bg-muted/[0.08] font-medium"
                : "rounded-md px-2 py-1.5 hover:bg-accent/40",
              dragFolderId === folder.id && "opacity-40 scale-[0.98]",
              dragRequestId &&
                dragHoverFolderId === folder.id &&
                "ring-1 ring-primary/30 bg-primary/[0.03]",
            )}
            style={{ paddingLeft: `${indent + 20}px` }}
            draggable={!!onReorderFolders}
            onDragStart={(e) => {
              setDragFolderId(folder.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", folder.id);
              dragOverFolderIdRef.current = null;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              dragOverFolderIdRef.current = folder.id;
              setDragHoverFolderId(folder.id);
            }}
            onDragEnd={() => {
              const targetId = dragOverFolderIdRef.current;
              const draggedId = folder.id;
              if (draggedId && targetId && onReorderFolders && draggedId !== targetId) {
                const parentId = folder.parentId;
                const siblings = folders.filter((f) => f.parentId === parentId).map((f) => f.id);
                const fromIdx = siblings.indexOf(draggedId);
                const toIdx = siblings.indexOf(targetId);
                if (fromIdx !== -1 && toIdx !== -1) {
                  siblings.splice(fromIdx, 1);
                  siblings.splice(toIdx, 0, draggedId);
                  onReorderFolders(collection.id, parentId, siblings);
                }
              }
              setDragFolderId(null);
              dragOverFolderIdRef.current = null;
            }}
          >
            {/* Drag handle */}
            {onReorderFolders && (
              <div className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/10 hover:text-muted-foreground/30 transition-colors duration-200 mr-0.5">
                <GripVertical className="size-3" />
              </div>
            )}

            <button
              onClick={() => toggleFolder(folder.id)}
              className={cn(
                "shrink-0 rounded-sm p-0.5 transition-all duration-150",
                "text-muted-foreground/40 hover:text-foreground hover:bg-accent/60",
              )}
            >
              {isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </button>

            <span className="mx-1.5 shrink-0 transition-transform duration-200">
              {isExpanded ? (
                <FolderOpen className={cn(isRoot ? "size-4" : "size-3.5", "text-primary/70")} />
              ) : (
                <Folder
                  className={cn(
                    isRoot ? "size-4" : "size-3.5",
                    "text-primary/60 group-hover:text-primary/80",
                  )}
                />
              )}
            </span>

            {editingFolderId === folder.id ? (
              <div
                className="flex w-full items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRename(folder.id);
                    if (e.key === "Escape") setEditingFolderId(null);
                  }}
                  autoFocus
                  className="h-6 text-xs"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleConfirmRename(folder.id)}
                  className="h-6 px-1.5 text-[10px] font-semibold text-primary"
                >
                  OK
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span
                  className={cn(
                    "truncate text-foreground/80 group-hover:text-foreground transition-colors",
                    isRoot ? "text-sm font-semibold" : "text-sm font-medium",
                  )}
                >
                  {folder.name}
                </span>
                <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/40 bg-muted/40 px-1.5 py-0.5 rounded-full leading-none">
                  {getTotalCount(folder, folders, requests)}
                </span>
              </div>
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
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => handleCreateFolder(folder.id)}>
                  <FolderPlus className="mr-2 size-3.5" /> Sub-folder
                </DropdownMenuItem>
                {onMoveFolder && (
                  <DropdownMenuItem onClick={() => handleStartMoveFolder(folder.id)}>
                    <FolderPlus className="mr-2 size-3.5" /> Move to...
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handleStartRename(folder.id, folder.name)}>
                  <Edit2 className="mr-2 size-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    confirmDelete(`Delete folder "${folder.name}" and move requests to root?`, () =>
                      onDeleteFolder(collection.id, folder.id),
                    )
                  }
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 size-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Expanded content */}
          {isExpanded && (
            <div className="relative pb-0.5">
              {hasContent ? (
                <div className="space-y-0.5">
                  {children.map((child, i) =>
                    renderFolder(
                      child,
                      depth + 1,
                      i === children.length - 1 && folderRequests.length === 0,
                      [...stems, depth],
                    ),
                  )}
                  {folderRequests.map((request, i) =>
                    renderRequest(request, depth + 1, i === folderRequests.length - 1, [
                      ...stems,
                      depth,
                    ]),
                  )}
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 py-1 text-xs text-muted-foreground/40 italic"
                  style={{ paddingLeft: `${indent + 40}px` }}
                >
                  <span className="inline-block size-1 rounded-full bg-border/60" />
                  Empty
                </div>
              )}
            </div>
          )}
        </div>
      );
    },
    [
      expandedFolders,
      editingFolderId,
      renameValue,
      toggleFolder,
      childFolders,
      requestsInFolder,
      folders,
      handleConfirmRename,
      handleCreateFolder,
      handleStartMoveFolder,
      handleStartRename,
      confirmDelete,
      onDeleteFolder,
      onMoveFolder,
      onReorderFolders,
      dragFolderId,
      dragRequestId,
      dragHoverFolderId,
      setDragHoverFolderId,
      collection.id,
      renderRequest,
      requests,
    ],
  );

  const renderFolderOption = useCallback(
    (folder: CollectionFolder, depth: number) => (
      <button
        key={folder.id}
        onClick={() => handleConfirmMove(folder.id)}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        className="w-full text-left px-3 py-2 rounded-md hover:bg-accent/60 hover:shadow-xs text-sm flex items-center gap-2 transition-all duration-150"
      >
        <Folder className="size-4 shrink-0 text-primary/60" />
        <span className="truncate text-foreground/80">{folder.name}</span>
      </button>
    ),
    [handleConfirmMove],
  );

  return (
    <div className="pl-5 pt-0.5 pb-2">
      {/* Root-level folders */}
      {rootFolders.length > 0 && (
        <div className="space-y-0.5">
          {rootFolders.map((folder, i) =>
            renderFolder(folder, 0, i === rootFolders.length - 1 && rootRequests.length === 0),
          )}
        </div>
      )}

      {/* Divider + Uncategorized */}
      {rootRequests.length > 0 && (
        <>
          {rootFolders.length > 0 && <div className="my-1.5 mx-3 border-t border-border/30" />}
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="h-px flex-1 bg-border/15" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/30 font-semibold">
              Uncategorized
            </span>
            <div className="h-px flex-1 bg-border/15" />
          </div>
          <div className="space-y-0.5">
            {rootRequests.map((request) => renderRequest(request, 0))}
          </div>
        </>
      )}

      {/* Empty state */}
      {folders.length === 0 && rootRequests.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-5 px-3 text-center animate-fade-in">
          <div className="rounded-xl bg-muted/15 p-2.5 ring-1 ring-border/30">
            <Folder className="size-5 text-muted-foreground/25" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground/60">No requests yet</p>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5">
              Add requests or create a folder
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCreateFolder(null)}
            className="h-7 gap-1 text-xs font-medium text-muted-foreground/60 hover:text-foreground"
          >
            <FolderPlus className="size-3" />
            {t("collections.folder.create")}
          </Button>
        </div>
      )}

      {/* Inline "New folder" button */}
      {folders.length > 0 && (
        <div className="px-3 pt-1.5">
          <button
            onClick={() => handleCreateFolder(null)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/40 hover:text-foreground/70 transition-all duration-150 px-2 py-1 rounded-md hover:bg-accent/30 w-full"
          >
            <FolderPlus className="size-3" />
            {t("collections.folder.new")}
          </button>
        </div>
      )}

      {/* Create folder dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FolderPlus className="size-4 text-primary" />
              {t("collections.folder.new")}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("collections.folder.namePlaceholder")}
            autoFocus
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmCreate();
              if (e.key === "Escape") setCreateDialogOpen(false);
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateDialogOpen(false)}
              className="text-xs"
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={handleConfirmCreate} className="text-xs shadow-xs">
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to folder dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {movingFolderId
                ? t("collections.folder.moveFolder")
                : t("collections.folder.moveRequest")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-60 overflow-y-auto px-1">
            <button
              onClick={() => handleConfirmMove(null)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent/60 hover:shadow-xs text-sm text-muted-foreground/70 hover:text-foreground flex items-center gap-2 transition-all duration-150"
            >
              <span className="flex size-5 items-center justify-center rounded bg-muted/50">
                <Folder className="size-3 text-muted-foreground/50" />
              </span>
              Root (no folder)
            </button>
            {renderFolderTree(null, 0, folders, renderFolderOption)}
            {folders.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-muted-foreground/50">
                  No folders yet. Create one first.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoveDialogOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
