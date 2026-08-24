"use client";

import { useEffect, useRef, useState } from "react";
import type { MockConfig, MockRoute } from "@reqly/mock-engine";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { loadMockDraft, saveMockDraft } from "@/lib/mock/convert";
import {
  publishMockDraft,
  registerMockDraftWriter,
} from "./mock-draft-bridge";
import { duplicateRoute, createExampleConfig, makeRoute, sanitizeConfig } from "./mock-utils";
import type { RowClickMods } from "./route-list";

const K = {
  importInvalid: "mocks.actions.importInvalid",
  imported: "mocks.actions.imported",
  generatedToast: "mocks.generate.generatedToast",
  deleteTitle: "mocks.routes.deleteTitle",
  deleteDescMany: "mocks.bulk.deleteDesc",
  deleteManyTitle: "mocks.bulk.deleteTitle",
  deletedToast: "mocks.bulk.deletedToast",
  undoAction: "mocks.undo.action",
} as const;

const DRAFT_AUTOSAVE_MS = 600;

/** i18n descriptor carried through the replace flow so success fires only when it really happened. */
export interface MockSuccessTitle {
  key: string;
  fallback: string;
}

interface PendingReplace {
  next: MockConfig;
  successTitle: MockSuccessTitle | null;
}

const UNDO_TOAST_DURATION_MS = 7000;

/** Config draft lifecycle: routes CRUD, multi-selection with bulk ops, replace/import flows. */
export function useMockRoutes() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<MockConfig | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const anchorRef = useRef<string | null>(null);

  // Brouillon : exemple embarqué > localStorage.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration from storage
    setConfig(loadMockDraft() ?? createExampleConfig());
  }, []);

  // Pont outils IA ↔ brouillon : publication de l'état + setter d'écriture.
  useEffect(() => {
    publishMockDraft(config);
  }, [config]);

  useEffect(() => {
    registerMockDraftWriter((next) => {
      setConfig(next);
      setSelectedRouteId(next.routes[0]?.id ?? null);
      setSelectedIds(new Set());
    });
    return () => registerMockDraftWriter(null);
  }, []);

  // Autosave du brouillon (debounce).
  useEffect(() => {
    if (!config) return;
    const handle = window.setTimeout(() => {
      saveMockDraft(config);
      const now = new Date();
      setDraftSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      );
    }, DRAFT_AUTOSAVE_MS);
    return () => window.clearTimeout(handle);
  }, [config]);

  // Escape vide la multi-sélection.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setSelectedIds((prev) => (prev.size > 0 ? new Set<string>() : prev));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const routes = config?.routes ?? [];
  const selectedRoute =
    routes.find((r) => r.id === selectedRouteId) ?? (routes.length > 0 ? routes[0] : undefined);

  function updateConfig(updater: (prev: MockConfig) => MockConfig) {
    setConfig((prev) => (prev ? updater(prev) : prev));
  }

  function patchRoute(id: string, patch: Partial<MockRoute>) {
    updateConfig((prev) => ({
      ...prev,
      routes: prev.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }

  function requestDeleteDismiss() {
    setDeleteTarget(null);
  }

  function addRoute() {
    const route = makeRoute("GET", "/nouvelle-route");
    updateConfig((prev) => ({ ...prev, routes: [...prev.routes, route] }));
    setSelectedRouteId(route.id);
  }

  function duplicateRouteById(id: string) {
    const source = routes.find((r) => r.id === id);
    if (!source || !config) return;
    const copy = duplicateRoute(source);
    const index = routes.findIndex((r) => r.id === id);
    const nextRoutes = [...routes];
    nextRoutes.splice(index + 1, 0, copy);
    setConfig({ ...config, routes: nextRoutes });
    setSelectedRouteId(copy.id);
  }

  function toggleRouteEnabled(id: string, enabled: boolean) {
    updateConfig((prev) => ({
      ...prev,
      routes: prev.routes.map((r) => (r.id === id ? { ...r, enabled } : r)),
    }));
  }

  function duplicateSelected() {
    if (!config) return;
    const prev = config;
    const nextRoutes: MockRoute[] = [];
    for (const route of config.routes) {
      nextRoutes.push(route);
      if (selectedIds.has(route.id)) nextRoutes.push(duplicateRoute(route));
    }
    setConfig({ ...config, routes: nextRoutes });
    toast(
      undoableToast(prev, { key: "mocks.bulk.duplicatedToast", fallback: "Routes dupliquées" }),
    );
  }

  function setEnabledSelected(enabled: boolean) {
    if (!config || selectedIds.size === 0) return;
    const prev = config;
    updateConfig((prevCfg) => ({
      ...prevCfg,
      routes: prevCfg.routes.map((r) => (selectedIds.has(r.id) ? { ...r, enabled } : r)),
    }));
    toast(
      undoableToast(prev, {
        key: "mocks.bulk.enabledToast",
        fallback: enabled
          ? "{{count}} routes activées"
          : "{{count}} routes désactivées",
      }, { count: selectedIds.size }),
    );
  }

  function requestDelete(ids: string[]) {
    setDeleteTarget(ids);
  }

  /** Restaure un snapshot de config et purge la sélection des ids disparus. */
  function restoreConfig(prev: MockConfig) {
    setConfig(prev);
    const ids = new Set(prev.routes.map((r) => r.id));
    setSelectedIds((prevSel) => new Set([...prevSel].filter((id) => ids.has(id))));
    setSelectedRouteId((id) => (id && ids.has(id) ? id : null));
  }

  function undoableToast(
    prev: MockConfig,
    title: { key: string; fallback: string },
    values?: Record<string, unknown>,
  ) {
    return {
      title: t(title.key, { defaultValue: title.fallback, ...(values ?? {}) }),
      action: {
        label: t(K.undoAction, { defaultValue: "Annuler" }),
        onClick: () => restoreConfig(prev),
      },
      duration: UNDO_TOAST_DURATION_MS,
    };
  }

  function confirmDelete() {
    if (!config || !deleteTarget) return;
    const prev = config;
    const ids = new Set(deleteTarget);
    const remaining = config.routes.filter((r) => !ids.has(r.id));
    setConfig({ ...config, routes: remaining });
    setSelectedIds((prevSel) => new Set([...prevSel].filter((i) => !ids.has(i))));
    if (selectedRouteId && ids.has(selectedRouteId)) setSelectedRouteId(null);
    toast(
      undoableToast(
        prev,
        { key: K.deletedToast, fallback: "{{count}} routes supprimées" },
        { count: ids.size },
      ),
    );
    setDeleteTarget(null);
  }

  function doReplace(next: MockConfig, successTitle?: MockSuccessTitle | null) {
    const prev = config;
    setConfig(next);
    setSelectedRouteId(next.routes[0]?.id ?? null);
    setSelectedIds(new Set());
    setPendingReplace(null);
    if (successTitle && prev) {
      toast(undoableToast(prev, successTitle));
    }
  }

  function requestReplace(next: MockConfig, successTitle?: MockSuccessTitle | null) {
    if ((config?.routes.length ?? 0) > 0) setPendingReplace({ next, successTitle: successTitle ?? null });
    else doReplace(next, successTitle);
  }

  async function handleImportFile(file: File) {
    let parsed: unknown;
    try {
      const text = await file.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        // Fallback YAML (js-yaml présent dans les deps web).
        const yaml = await import("js-yaml");
        parsed = yaml.load(text);
      }
    } catch {
      parsed = null;
    }
    const clean = sanitizeConfig(parsed);
    if (!clean) {
      toast({
        title: t(K.importInvalid, {
          defaultValue: "Fichier invalide : version 1 et routes requises.",
        }),
        variant: "destructive",
      });
      return;
    }
    // Le succès n'est annoncé qu'après remplacement effectif (doReplace).
    requestReplace(clean, { key: K.imported, fallback: "Config importée" });
  }

  function handleRowClick(id: string, mods: RowClickMods) {
    if (mods.shift) {
      const anchor = anchorRef.current;
      const ai = anchor ? routes.findIndex((r) => r.id === anchor) : -1;
      const bi = routes.findIndex((r) => r.id === id);
      if (ai === -1 || bi === -1) {
        setSelectedIds(new Set([id]));
        return;
      }
      const [start, end] = ai <= bi ? [ai, bi] : [bi, ai];
      setSelectedIds(new Set(routes.slice(start, end + 1).map((r) => r.id)));
      return;
    }
    anchorRef.current = id;
    if (mods.meta) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelectedIds(new Set());
    setSelectedRouteId(id);
  }

  function toggleSelected(id: string) {
    anchorRef.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const deleteTargetRoutes =
    deleteTarget?.length === 1 ? routes.find((r) => r.id === deleteTarget[0]) : undefined;

  return {
    config,
    routes,
    selectedRoute,
    selectedIds,
    draftSavedAt,
    pendingReplace,
    setPendingReplace,
    deleteTarget,
    deleteTargetRoutes,
    requestDelete,
    requestDeleteDismiss,
    confirmDelete,
    patchRoute,
    addRoute,
    duplicateRouteById,
    toggleRouteEnabled,
    duplicateSelected,
    setEnabledSelected,
    deleteSelected: () => setDeleteTarget([...selectedIds]),
    handleImportFile,
    requestReplace,
    doReplace,
    handleRowClick,
    toggleSelected,
    clearSelection,
  };
}
