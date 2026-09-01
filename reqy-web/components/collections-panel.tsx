"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus, Layers, Import, Loader2 } from "lucide-react";
import { methodBadge } from "@/lib/http-method-colors";
import { cn, downloadJson } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import { toast } from "@/hooks/use-toast";

import type { Collection, RequestItem, HttpMethod } from "@/hooks/use-request-store";
import { requestItemSchema } from "@/lib/import-schemas";

import { DeleteConfirmDialog, type PendingDelete } from "@/components/collections-delete-dialog";
import { CollectionsEmptyState } from "@/components/collections-empty-state";
import { SearchFilterBar } from "@/components/collections-search-bar";
import { SelectionToolbar } from "@/components/collections-selection-toolbar";
import { CollectionRow } from "@/components/collection-row";
import { indexRequests, searchIndex, indexSize } from "@/src/ai/cloud-engine/search-index";
import { useTranslation } from "react-i18next";

export type NewCollectionInput = {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
};

/**
 * Clés i18n locales absentes des fichiers de locale (fallback FR inline via
 * defaultValue). Référencées via constantes pour rester hors du scan statique.
 */
const PANEL_KEYS = {
  partialImported: "collections.panel.partialImported",
  partialSkipped: "collections.panel.partialSkipped",
  partialMore: "collections.panel.partialMore",
  unnamedRequest: "collections.panel.unnamedRequest",
  dragDuplicateHint: "collections.panel.dragDuplicateHint",
} as const;

export type NewRequestInput = Omit<RequestItem, "id" | "createdAt" | "updatedAt">;

interface CollectionsPanelProps {
  collections: Collection[];
  /** R11 — id de la dernière collection importée : scroll + highlight à sa réception. */
  highlightCollectionId?: string | null;
  onSelectRequest: (request: RequestItem) => void;
  onSelectAndSendRequest?: (request: RequestItem) => void;

  onAddCollection: (data?: NewCollectionInput) => string;
  onDeleteCollection: (id: string) => void;
  onDuplicateCollection?: (id: string) => void;
  onReorderCollections?: (orderedIds: string[]) => void;
  onRenameCollection: (id: string, name: string) => void;
  onAddRequestToCollection: (collectionId: string, request?: NewRequestInput) => void;
  onRemoveRequestFromCollection: (collectionId: string, requestId: string) => void;
  // Folder operations
  onAddFolder?: (collectionId: string, name: string, parentId: string | null) => string;
  onRenameFolder?: (collectionId: string, folderId: string, name: string) => void;
  onDeleteFolder?: (collectionId: string, folderId: string) => void;
  onMoveRequestToFolder?: (
    collectionId: string,
    requestId: string,
    folderId: string | null,
  ) => void;
  onMoveFolder?: (collectionId: string, folderId: string, newParentId: string | null) => void;
  // Reorder operations
  onReorderRequestsInCollection?: (
    collectionId: string,
    folderId: string | null,
    orderedRequestIds: string[],
  ) => void;
  onReorderFolders?: (
    collectionId: string,
    parentFolderId: string | null,
    orderedFolderIds: string[],
  ) => void;
  onMoveBetweenCollections?: (
    sourceCollectionId: string,
    targetCollectionId: string,
    requestId: string,
    targetIndex: number,
  ) => void;
  onRunCollection?: (collection: Collection) => void;
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 Mo — anti-DoS

export function CollectionsPanel({
  collections,
  highlightCollectionId,
  onSelectRequest,
  onSelectAndSendRequest,
  onAddCollection,
  onDeleteCollection,
  onDuplicateCollection,
  onRenameCollection,
  onAddRequestToCollection,
  onRemoveRequestFromCollection,
  onMoveRequestToFolder,
  onReorderRequestsInCollection,
  onMoveBetweenCollections,
  onRunCollection,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onReorderCollections,
  onReorderFolders,
}: CollectionsPanelProps) {
  const { t } = useTranslation();
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const stored = localStorage.getItem("collections-expanded");
      if (stored) return new Set<string>(JSON.parse(stored));
    } catch {
      /* ignore corrupt data */
    }
    return new Set<string>();
  });
  const [activeDragItem, setActiveDragItem] = useState<{
    id: string;
    name: string;
    method: string;
  } | null>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<Set<HttpMethod>>(new Set());
  const [sortBy, setSortBy] = useState<"name" | "updated" | "requests" | "manual">("name");
  const [showFilters, setShowFilters] = useState(false);
  const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(false);
  const [_indexing, setIndexing] = useState(false);
  const [semanticResults, setSemanticResults] = useState<Set<string> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());

  // ── R11 — highlight temporaire de la collection importée ──
  const [lastImportId, setLastImportId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [newBadgeId, setNewBadgeId] = useState<string | null>(null);
  // Dérivation props→state pendant le rendu (pattern React officiel) : le ring
  // et le badge apparaissent dès la réception du nouvel id.
  if (highlightCollectionId && highlightCollectionId !== lastImportId) {
    setLastImportId(highlightCollectionId);
    setHighlightId(highlightCollectionId);
    setNewBadgeId(highlightCollectionId);
  }
  useEffect(() => {
    if (!highlightCollectionId) return;
    const el = document.querySelector(`[data-collection-id="${highlightCollectionId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const ringTimer = window.setTimeout(() => setHighlightId(null), 2000);
    const badgeTimer = window.setTimeout(() => setNewBadgeId(null), 10000);
    return () => {
      window.clearTimeout(ringTimer);
      window.clearTimeout(badgeTimer);
    };
  }, [highlightCollectionId]);

  // ── T1 — Ctrl/Meta maintenu au démarrage du drag → hint « dupliquer » ──
  const [dragWithModifier, setDragWithModifier] = useState(false);

  // ── Auto-index requests for semantic search ──
  useEffect(() => {
    let mounted = true;
    const doIndex = async () => {
      try {
        const size = await indexSize();
        if (size > 0 && !semanticSearchEnabled) return;
        const flat = collections.flatMap((col) =>
          col.requests.map((req) => ({
            requestId: req.id,
            collectionId: col.id,
            collectionName: col.name,
            method: req.method,
            name: req.name,
            url: req.url,
            body: req.body,
          })),
        );
        if (flat.length > 0) {
          setIndexing(true);
          await indexRequests(flat);
        }
      } catch {
        /* silently ignore indexing errors */
      } finally {
        if (mounted) setIndexing(false);
      }
    };
    if (collections.length > 0) {
      void doIndex();
    }
    return () => {
      mounted = false;
    };
  }, [collections, semanticSearchEnabled]);

  const handleToggleSemanticSearch = useCallback((enabled: boolean) => {
    setSemanticSearchEnabled(enabled);
    if (!enabled) setSemanticResults(null);
  }, []);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── dnd-kit event handlers ──
  const handleDndStart = useCallback(
    (event: DragStartEvent) => {
      const { active, activatorEvent } = event;
      // T1 — détecter Ctrl/Meta pour afficher le hint de duplication sur l'overlay
      const act = activatorEvent as MouseEvent | KeyboardEvent | null;
      setDragWithModifier(
        !!act && (("ctrlKey" in act && act.ctrlKey) || ("metaKey" in act && act.metaKey)),
      );

      const data = active.data.current as { type?: string; collectionId?: string } | undefined;
      if (!data || data.type !== "request") return;

      // Build the active drag item for the overlay
      const rawId = String(active.id).replace(/^req::/, "");
      for (const col of collections) {
        const req = col.requests.find((r) => r.id === rawId);
        if (req) {
          setActiveDragItem({ id: req.id, name: req.name, method: req.method });
          return;
        }
      }
    },
    [collections],
  );

  const handleDndEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragItem(null);
      setDragWithModifier(false);
      const { active, over, activatorEvent } = event;
      if (!over) return;

      const isCtrl =
        (activatorEvent as MouseEvent).ctrlKey || (activatorEvent as MouseEvent).metaKey;

      const activeId = String(active.id);
      const overId = String(over.id);
      const activeData = active.data.current as
        { type?: string; collectionId?: string } | undefined;
      const overData = over.data.current as
        { type?: string; collectionId?: string; folderId?: string } | undefined;
      if (!activeData || !overData) return;

      const requestId = activeId.replace(/^req::/, "");
      const sourceColId = activeData.collectionId ?? "";
      const targetColId = overData.collectionId ?? "";

      // ── Dropped on a folder: move request to that folder ──
      if (overData.type === "folder" && overData.folderId && onMoveRequestToFolder) {
        onMoveRequestToFolder(targetColId, requestId, overData.folderId);
        return;
      }

      // ── Ctrl/Meta+Drag: duplicate instead of move ──
      if (isCtrl) {
        const sourceCol = collections.find((c) => c.id === sourceColId);
        if (!sourceCol) return;
        const sourceReq = sourceCol.requests.find((r) => r.id === requestId);
        if (!sourceReq) return;
        const duplicate: Omit<RequestItem, "id" | "createdAt" | "updatedAt"> = {
          name: `${sourceReq.name}${t("collections.panel.copySuffix")}`,
          method: sourceReq.method,
          url: sourceReq.url,
          endpoint: sourceReq.endpoint,
          headers: sourceReq.headers,
          body: sourceReq.body,
          bodyType: sourceReq.bodyType,
          authType: sourceReq.authType,
          authToken: sourceReq.authToken,
          queryParams: sourceReq.queryParams,
          pathParams: sourceReq.pathParams,
          protocol: sourceReq.protocol,
          graphql: sourceReq.graphql ? { ...sourceReq.graphql } : undefined,
          preRequestScript: sourceReq.preRequestScript,
          postResponseScript: sourceReq.postResponseScript,
          datasetKey: sourceReq.datasetKey,
        };
        onAddRequestToCollection(targetColId, duplicate);
        return;
      }

      if (overData.type === "request") {
        const targetRequestId = overId.replace(/^req::/, "");

        if (sourceColId === targetColId) {
          // ── Intra-collection reorder ──
          if (!onReorderRequestsInCollection) return;
          const sourceCol = collections.find((c) => c.id === sourceColId);
          if (!sourceCol) return;
          const sourceReq = sourceCol.requests.find((r) => r.id === requestId);
          const sourceFolderId = sourceReq?.folderId ?? null;
          const targetReq = sourceCol.requests.find((r) => r.id === targetRequestId);
          // Ne réordonner que si les deux requêtes sont au même niveau
          // (même dossier, ou toutes deux à la racine).
          if ((targetReq?.folderId ?? null) !== sourceFolderId) return;
          const siblings = sourceCol.requests
            .filter((r) => (r.folderId ?? null) === sourceFolderId)
            .map((r) => r.id);
          const fromIdx = siblings.indexOf(requestId);
          const toIdx = siblings.indexOf(targetRequestId);
          if (fromIdx === -1 || toIdx === -1) return;
          siblings.splice(fromIdx, 1);
          siblings.splice(toIdx, 0, requestId);
          onReorderRequestsInCollection(sourceColId, sourceFolderId, siblings);
        } else {
          // ── Cross-collection move: insert before the target request ──
          if (!onMoveBetweenCollections) return;
          const targetCol = collections.find((c) => c.id === targetColId);
          if (!targetCol) return;
          const insertAt = targetCol.requests.findIndex((r) => r.id === targetRequestId);
          onMoveBetweenCollections(
            sourceColId,
            targetColId,
            requestId,
            insertAt >= 0 ? insertAt : targetCol.requests.length,
          );
        }
      } else if (overData.type === "collection") {
        // ── Dropped on collection header (append to end) ──
        if (sourceColId === targetColId) return;
        if (!onMoveBetweenCollections) return;
        const targetCol = collections.find((c) => c.id === targetColId);
        onMoveBetweenCollections(
          sourceColId,
          targetColId,
          requestId,
          targetCol?.requests.length ?? 0,
        );
      }
    },
    [
      collections,
      onReorderRequestsInCollection,
      onMoveBetweenCollections,
      onAddRequestToCollection,
      onMoveRequestToFolder,
      t,
    ],
  );

  // ── R23 — résumé partial-success du canal JSON générique ──
  const MAX_SKIPPED_NAMES_SHOWN = 5;
  const buildPartialImportDescription = (
    importedCount: number,
    skippedNames: string[],
  ): string | undefined => {
    if (importedCount === 0 && skippedNames.length === 0) return undefined;
    let summary = t(PANEL_KEYS.partialImported, {
      count: importedCount,
      defaultValue: "{{count}} importée(s)",
    });
    if (skippedNames.length > 0) {
      summary += ` · ${t(PANEL_KEYS.partialSkipped, {
        count: skippedNames.length,
        defaultValue: "{{count}} ignorée(s) (format invalide)",
      })}`;
      const shown = skippedNames.slice(0, MAX_SKIPPED_NAMES_SHOWN);
      const rest = skippedNames.length - shown.length;
      summary += `\n${shown.map((n) => `• ${n}`).join("\n")}`;
      if (rest > 0) {
        summary += `\n${t(PANEL_KEYS.partialMore, {
          count: rest,
          defaultValue: "+{{count}} autres",
        })}`;
      }
    }
    return summary;
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Anti-DoS : refuser les fichiers déraisonnables avant lecture/parse.
    if (file.size > MAX_IMPORT_BYTES) {
      toast({
        title: t("collections.panel.importTooLarge"),
        description: t("collections.panel.importTooLargeHint", {
          size: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)),
        }),
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const processCollection = (
        colData: {
          name?: string;
          description?: string;
          color?: string;
          icon?: string;
          folders?: Array<{ id?: string; name: string; parentId?: string | null }>;
          requests?: unknown[];
        },
        countRequest: (req: unknown, parsedOk: boolean) => void,
      ) => {
        const colId = onAddCollection({
          name: colData.name || t("collections.panel.importedCollection"),
          description: colData.description || "",
          color: colData.color || "emerald",
          icon: colData.icon || "package",
        });

        // Restaurer les dossiers (avec parentId pour les imbrications)
        const folderIdMap = new Map<string, string>();
        for (const folder of colData.folders ?? []) {
          if (!folder.name) continue;
          const parentId = folder.parentId ? (folderIdMap.get(folder.parentId) ?? null) : null;
          const newId = onAddFolder?.(colId, folder.name, parentId);
          if (newId && folder.id) folderIdMap.set(folder.id, newId);
        }

        if (colData.requests && Array.isArray(colData.requests)) {
          colData.requests.forEach((req: unknown) => {
            if (onAddRequestToCollection) {
              const parsed = requestItemSchema.safeParse(req);
              if (parsed.success) {
                const {
                  id: _id,
                  createdAt: _createdAt,
                  updatedAt: _updatedAt,
                  folderId,
                  ...rest
                } = parsed.data;
                // Mapper l'ancien folderId vers le nouveau
                const mappedFolderId = folderId ? (folderIdMap.get(folderId) ?? null) : null;
                onAddRequestToCollection(colId, {
                  ...rest,
                  ...(mappedFolderId ? { folderId: mappedFolderId } : {}),
                });
              }
              // R23 — les requêtes invalides ne sont plus droppées silencieusement
              countRequest(req, parsed.success);
            }
          });
        }
      };

      const dataObj = data as { type?: string; requests?: unknown[]; collections?: unknown[] };

      // R23 — compteurs partial-success partagés par toutes les collections
      let totalImported = 0;
      const skippedNames: string[] = [];
      const countRequest = (req: unknown, parsedOk: boolean) => {
        if (parsedOk) {
          totalImported++;
          return;
        }
        const rawName = (req as { name?: unknown } | null)?.name;
        skippedNames.push(
          typeof rawName === "string" && rawName.trim()
            ? rawName
            : t(PANEL_KEYS.unnamedRequest, { defaultValue: "Requête sans nom" }),
        );
      };

      if (dataObj.type === "collection" || dataObj.requests) {
        processCollection(dataObj as Parameters<typeof processCollection>[0], countRequest);
        toast({
          title: t("collections.panel.importedCollection"),
          description: buildPartialImportDescription(totalImported, skippedNames),
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
      } else if (dataObj.collections && Array.isArray(dataObj.collections)) {
        dataObj.collections.forEach((c) =>
          processCollection(c as Parameters<typeof processCollection>[0], countRequest),
        );
        toast({
          title: t("collections.panel.collectionsImported", { count: dataObj.collections.length }),
          description: buildPartialImportDescription(totalImported, skippedNames),
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
      } else {
        toast({
          title: t("collections.panel.unknownFormat"),
          variant: "destructive",
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
      }
    } catch {
      toast({
        title: t("collections.panel.invalidJson"),
        variant: "destructive",
        meta: { event: "importExport" },
      } as unknown as Parameters<typeof toast>[0]);
    } finally {
      setImporting(false);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const confirmDelete = (label: string, onConfirm: () => void) => {
    setPendingDelete({ label, onConfirm });
  };

  const toggleCollection = (id: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("collections-expanded", JSON.stringify([...next]));
      } catch {
        /* storage full or unavailable */
      }
      return next;
    });
  };

  // --- Selection helpers ---
  const toggleSelectCollection = (id: string) => {
    setSelectedCollectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectRequest = (colId: string, reqId: string) => {
    const key = `${colId}::${reqId}`;
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedCollectionIds(new Set());
    setSelectedRequestIds(new Set());
  };

  const allSelected = collections.length > 0 && selectedCollectionIds.size === collections.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedCollectionIds(new Set(collections.map((c) => c.id)));
    }
  };

  const toggleMethodFilter = (method: HttpMethod) => {
    setMethodFilter((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  };

  // --- Bulk actions ---
  const bulkExport = async () => {
    setExporting(true);
    const isTauri =
      !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ||
      !!(window as unknown as Record<string, unknown>).__TAURI__;

    const cols = collections.filter((c) => selectedCollectionIds.has(c.id));

    const reqsByCol: Record<string, RequestItem[]> = {};
    selectedRequestIds.forEach((key) => {
      const [colId, reqId] = key.split("::");
      const col = collections.find((c) => c.id === colId);
      const req = col?.requests.find((r) => r.id === reqId);
      if (req) {
        if (!reqsByCol[colId]) reqsByCol[colId] = [];
        reqsByCol[colId].push(req);
      }
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      collections: [
        ...cols,
        ...Object.entries(reqsByCol)
          .filter(([colId]) => !selectedCollectionIds.has(colId))
          .map(([colId, reqs]) => {
            const col = collections.find((c) => c.id === colId)!;
            return { ...col, requests: reqs };
          }),
      ],
    };

    const defaultName =
      cols.length === 1 && selectedRequestIds.size === 0
        ? `${cols[0].name.replace(/\s+/g, "_").toLowerCase()}_collection.json`
        : "export_selection.json";

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const savedPath = await invoke<string>("export_json", {
          content: JSON.stringify(exportData, null, 2),
          defaultName,
        });
        toast({
          title: t("collections.panel.exported", { path: savedPath }),
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
        clearSelection();
      } catch (error: unknown) {
        if (error === "cancelled") {
          setExporting(false);
          return;
        }
        toast({
          title: t("collections.panel.exportError", { error: String(error) }),
          variant: "destructive",
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
        downloadJson(exportData, defaultName);
        setExporting(false);
      }
    } else {
      downloadJson(exportData, defaultName);
      toast({
        title: t("collections.panel.downloadComplete"),
        meta: { event: "importExport" },
      } as unknown as Parameters<typeof toast>[0]);
      clearSelection();
    }
    setExporting(false);
  };

  const bulkDelete = () => {
    const colCount = selectedCollectionIds.size;
    const reqCount = selectedRequestIds.size;
    const parts = [
      colCount > 0 && t("collections.panel.collectionCount", { count: colCount }),
      reqCount > 0 && t("collections.panel.requestCount", { count: reqCount }),
    ].filter((p): p is string => Boolean(p));
    const msg = parts.join(` ${t("collections.panel.and")} `);

    confirmDelete(t("collections.panel.deleteConfirm", { items: msg }), () => {
      selectedCollectionIds.forEach((id) => onDeleteCollection(id));
      selectedRequestIds.forEach((key) => {
        const [colId, reqId] = key.split("::");
        onRemoveRequestFromCollection(colId, reqId);
      });
      clearSelection();
    });
  };

  // --- Single item export ---
  const exportCollection = async (collection: Collection) => {
    setExporting(true);
    const isTauri =
      !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ||
      !!(window as unknown as Record<string, unknown>).__TAURI__;
    const exportData = {
      name: collection.name,
      description: collection.description,
      folders: collection.folders ?? [],
      requests: collection.requests,
      exportedAt: new Date().toISOString(),
      type: "collection",
    };
    const safeName = collection.name.replace(/\s+/g, "_").toLowerCase();

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const savedPath = await invoke<string>("export_json", {
          content: JSON.stringify(exportData, null, 2),
          defaultName: `${safeName}_collection.json`,
        });
        toast({
          title: t("collections.panel.saved", { path: savedPath }),
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
      } catch (error: unknown) {
        if (error === "cancelled") {
          setExporting(false);
          return;
        }
        toast({
          title: t("collections.panel.error", { error: String(error) }),
          variant: "destructive",
          meta: { event: "importExport" },
        } as unknown as Parameters<typeof toast>[0]);
        downloadJson(exportData, `${safeName}_collection.json`);
      }
    } else {
      downloadJson(exportData, `${safeName}_collection.json`);
    }
    setExporting(false);
  };

  // ── Semantic search ──
  useEffect(() => {
    if (!semanticSearchEnabled || !searchQuery) {
      const timer = window.setTimeout(() => setSemanticResults(null), 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      try {
        const results = await searchIndex(searchQuery, 30);
        if (!cancelled) {
          setSemanticResults(new Set(results.map((r) => r.item.requestId)));
        }
      } catch {
        if (!cancelled) setSemanticResults(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchQuery, semanticSearchEnabled]);

  const searchLower = searchQuery.toLowerCase();

  const sortedCollections = useMemo(() => {
    const list = [...collections];
    if (sortBy === "manual") return list;
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "updated") {
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sortBy === "requests") {
      list.sort((a, b) => b.requests.length - a.requests.length);
    }
    return list;
  }, [collections, sortBy]);

  // ── Filtered collections (text or semantic) ──
  const filteredCollections = useMemo(() => {
    if (semanticResults != null && searchQuery) {
      return sortedCollections
        .map((collection) => ({
          ...collection,
          requests: collection.requests.filter((req) => {
            if (methodFilter.size > 0 && !methodFilter.has(req.method)) return false;
            return semanticResults?.has(req.id) ?? true;
          }),
        }))
        .filter((collection) => {
          if (methodFilter.size > 0) {
            const originalCollection = collections.find((c) => c.id === collection.id);
            if (originalCollection?.requests.some((r) => methodFilter.has(r.method))) return true;
          }
          return collection.requests.length > 0;
        });
    }

    return sortedCollections
      .map((collection) => ({
        ...collection,
        requests: collection.requests.filter((req) => {
          if (methodFilter.size > 0 && !methodFilter.has(req.method)) return false;
          if (!searchQuery) return true;
          return (
            (req.name ?? "").toLowerCase().includes(searchLower) ||
            (req.endpoint ?? "").toLowerCase().includes(searchLower) ||
            (req.url ?? "").toLowerCase().includes(searchLower) ||
            (req.method ?? "").toLowerCase().includes(searchLower)
          );
        }),
      }))
      .filter((collection) => {
        if (!searchQuery && methodFilter.size === 0) return true;
        if (searchQuery && collection.name.toLowerCase().includes(searchLower)) return true;
        if (collection.requests.length > 0) return true;
        if (
          searchQuery &&
          collection.folders?.some((f) => f.name.toLowerCase().includes(searchLower))
        )
          return true;
        if (methodFilter.size > 0) {
          const originalCollection = collections.find((c) => c.id === collection.id);
          if (originalCollection?.requests.some((r) => methodFilter.has(r.method))) return true;
        }
        return false;
      });
  }, [sortedCollections, searchQuery, searchLower, methodFilter, semanticResults, collections]);

  // ── Déplacement des collections (menu Monter/Descendre) ──
  // Fix: opère sur l'ordre visible (filteredCollections) pour que le déplacement
  // corresponde à ce que l'utilisateur voit, puis persiste cet ordre et bascule
  // en tri manuel pour qu'il reste visible.
  const moveCollection = useCallback(
    (id: string, dir: -1 | 1) => {
      if (!onReorderCollections) return;
      const visibleIds = filteredCollections.map((c) => c.id);
      const idx = visibleIds.indexOf(id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= visibleIds.length) return;
      visibleIds.splice(idx, 1);
      visibleIds.splice(target, 0, id);
      // Si une recherche filtre, conserver les collections masquées à la fin
      const hiddenIds = collections.map((c) => c.id).filter((cid) => !visibleIds.includes(cid));
      onReorderCollections([...visibleIds, ...hiddenIds]);
      setSortBy("manual");
    },
    [collections, filteredCollections, onReorderCollections],
  );

  // Wrapper: ajouter un dossier auto-déploie la collection pour que le dossier soit visible
  const handleAddFolder = useCallback(
    (collectionId: string, name: string, parentId: string | null) => {
      const newId = onAddFolder?.(collectionId, name, parentId) ?? "";
      setExpandedCollections((prev) => {
        if (prev.has(collectionId)) return prev;
        const next = new Set(prev);
        next.add(collectionId);
        try {
          localStorage.setItem("collections-expanded", JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
      return newId;
    },
    [onAddFolder],
  );

  // ── Déplacement des dossiers (menu Monter/Descendre, par niveau) ──
  const moveFolderInCollection = useCallback(
    (collectionId: string, folderId: string, dir: -1 | 1) => {
      if (!onReorderFolders) return;
      const col = collections.find((c) => c.id === collectionId);
      const folders = col?.folders ?? [];
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const level = folder.parentId ?? null;
      const ids = folders.filter((f) => (f.parentId ?? null) === level).map((f) => f.id);
      const idx = ids.indexOf(folderId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= ids.length) return;
      ids.splice(idx, 1);
      ids.splice(target, 0, folderId);
      onReorderFolders(collectionId, level, ids);
    },
    [collections, onReorderFolders],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Layers className="size-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight leading-none">
              {t("collections.panel.title")}
            </h3>
            <p className="text-[10px] text-muted-foreground/40 leading-none mt-1">
              {t("collections.panel.total", { count: collections.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            onChange={handleImport}
            className="hidden"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="h-8 sm:h-7 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            title={t("collections.panel.importJson")}
          >
            {importing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Import className="size-3.5" />
            )}
            {importing ? t("collections.panel.importing") : t("collections.panel.import")}
          </Button>
          <Button
            variant="default"
            size="sm"
            data-testid="new-collection-button"
            onClick={() => onAddCollection()}
            className="h-7 gap-1.5 px-2.5 text-xs font-medium shadow-xs"
          >
            <Plus className="size-3.5" />
            {t("collections.panel.new")}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <SearchFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        allSelected={allSelected}
        onToggleSelectAll={toggleSelectAll}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        methodFilter={methodFilter}
        onToggleMethodFilter={toggleMethodFilter}
        sortBy={sortBy}
        onSortChange={(sort) => setSortBy(sort)}
        semanticSearchEnabled={semanticSearchEnabled}
        onToggleSemanticSearch={handleToggleSemanticSearch}
      />

      {/* Selection toolbar */}
      <SelectionToolbar
        selectedCollectionCount={selectedCollectionIds.size}
        selectedRequestCount={selectedRequestIds.size}
        exporting={exporting}
        onClear={clearSelection}
        onBulkExport={bulkExport}
        onBulkDelete={bulkDelete}
      />

      {/* Collections content with DnD */}
      <DndContext
        sensors={dndSensors}
        onDragStart={handleDndStart}
        onDragEnd={handleDndEnd}
        collisionDetection={closestCenter}
      >
        <div data-testid="collection-list" className="flex-1 overflow-y-auto">
          <div className="divide-y divide-border/40">
            {filteredCollections.map((collection, collectionIndex) => (
              <CollectionRow
                key={collection.id}
                collection={collection}
                isHighlighted={highlightId === collection.id}
                showNewBadge={newBadgeId === collection.id}
                isExpanded={expandedCollections.has(collection.id)}
                isSelected={selectedCollectionIds.has(collection.id)}
                editingCollectionId={editingCollectionId}
                renameValue={renameValue}
                selectedRequestIds={selectedRequestIds}
                onToggleExpand={toggleCollection}
                onToggleSelect={toggleSelectCollection}
                onToggleSelectRequest={toggleSelectRequest}
                onSelectRequest={onSelectRequest}
                onSelectAndSendRequest={onSelectAndSendRequest}
                onRenameStart={(id, name) => {
                  setEditingCollectionId(id);
                  setRenameValue(name);
                }}
                onRenameConfirm={(id) => {
                  onRenameCollection(
                    id,
                    renameValue.trim() || collections.find((c) => c.id === id)?.name || "",
                  );
                  setEditingCollectionId(null);
                }}
                onRenameChange={setRenameValue}
                onRenameCancel={() => setEditingCollectionId(null)}
                onAddRequest={onAddRequestToCollection}
                onExportCollection={exportCollection}
                onDuplicateCollection={onDuplicateCollection}
                onRunCollection={onRunCollection}
                onConfirmDelete={confirmDelete}
                onDeleteCollection={onDeleteCollection}
                onRemoveRequest={onRemoveRequestFromCollection}
                onMoveRequestToFolder={onMoveRequestToFolder}
                onAddFolder={handleAddFolder}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onMoveFolder={onMoveFolder}
                onMoveUp={() => moveCollection(collection.id, -1)}
                onMoveDown={() => moveCollection(collection.id, 1)}
                canMoveUp={collectionIndex > 0}
                canMoveDown={collectionIndex < filteredCollections.length - 1}
                onFolderMoveUp={(folderId: string) =>
                  moveFolderInCollection(collection.id, folderId, -1)
                }
                onFolderMoveDown={(folderId: string) =>
                  moveFolderInCollection(collection.id, folderId, 1)
                }
              />
            ))}
          </div>

          {filteredCollections.length === 0 && (
            <CollectionsEmptyState
              searchQuery={searchQuery}
              onCreateCollection={() => onAddCollection()}
            />
          )}
        </div>

        {/* Drag overlay — follows cursor during drag */}
        <DragOverlay dropAnimation={null}>
          {activeDragItem ? (
            <div className="flex items-center gap-2 py-1.5 px-3 bg-background border border-border/60 rounded-md shadow-lg max-w-[300px]">
              {dragWithModifier && (
                <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {t(PANEL_KEYS.dragDuplicateHint, { defaultValue: "Ctrl = dupliquer" })}
                </span>
              )}
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-white",
                  methodBadge[activeDragItem.method as keyof typeof methodBadge] ??
                    "bg-muted-foreground/30",
                )}
              >
                {activeDragItem.method}
              </span>
              <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
                {activeDragItem.name}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Delete confirmation modal */}
      <DeleteConfirmDialog pendingDelete={pendingDelete} onClose={() => setPendingDelete(null)} />
    </div>
  );
}
