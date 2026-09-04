"use client";

import { CollectionsPanel } from "@/components/collections-panel";
import { PostmanManageModal } from "@/components/postman/manage-modal";
import { PostmanImportModal } from "@/components/postman/import-modal";
import { ExportPostmanModal } from "@/components/export-postman-modal";
import { ImportOpenApiModal } from "@/components/import-openapi-modal";
import { ImportBrunoModal } from "@/components/import-bruno-modal";
import { GitLabImportModal } from "@/components/gitlab-import-modal";
import { OpenApiExportModal } from "@/components/openapi-export-modal";
import { Button } from "@/components/ui/button";
import { useRequestStore, type Collection, type RequestItem } from "@/hooks/use-request-store";

import { useRouter } from "next/navigation";
import { setPendingCollectionRequest, type PendingCollectionRequest } from "@/lib/request-bridge";
import { resolveUniqueCollectionName } from "@/lib/import-schemas";
import { generateOpenApiSpec } from "@/lib/openapi-export";

import { toast } from "@/hooks/use-toast";
import type { HttpMethod } from "@/lib/types";
import { useState, useEffect } from "react";
import { Loader2, Upload, Download, FileJson, GitFork, Package, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CollectionsPage() {
  // Clés i18n locales (absentes des fichiers de locale ; fallback FR inline).
  const PAGE_KEYS = {
    exportCancelled: "collections.toast.exportCancelled",
  } as const;

  const router = useRouter();
  const { t } = useTranslation();
  const {
    collections,
    history,
    addCollection,
    updateCollection,
    deleteCollection,
    duplicateCollection,
    reorderCollections,
    addRequestToCollection,
    removeRequestFromCollection,
    addFolder,
    renameFolder,
    deleteFolder,
    moveRequestToFolder,
    moveFolder,
    reorderRequestsInCollection,
    reorderFolders,
    moveRequestBetweenCollections,
  } = useRequestStore();

  const [postmanManageOpen, setPostmanManageOpen] = useState(false);
  const [postmanImportPreviewOpen, setPostmanImportPreviewOpen] = useState(false);
  const [selectedPostmanCollection, setSelectedPostmanCollection] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [postmanConnected, setPostmanConnected] = useState(false);
  const [postmanExportOpen, setPostmanExportOpen] = useState(false);
  const [openApiImportOpen, setOpenApiImportOpen] = useState(false);
  const [brunoImportOpen, setBrunoImportOpen] = useState(false);
  const [gitlabImportOpen, setGitlabImportOpen] = useState(false);
  const [exportingPostman, setExportingPostman] = useState(false);
  const [exportingOpenApi, setExportingOpenApi] = useState(false);
  const [openApiExportOpen, setOpenApiExportOpen] = useState(false);
  const [importChoiceOpen, setImportChoiceOpen] = useState(false);
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false);
  // R11 — id de la dernière collection importée, pour scroll + highlight
  const [highlightedCollectionId, setHighlightedCollectionId] = useState<string | null>(null);

  // Check Postman connection status (re-check on focus to catch login from other tabs/sections)
  useEffect(() => {
    const checkPostmanStatus = async () => {
      try {
        const response = await fetch("/api/postman-auth/status");
        const data = await response.json();
        setPostmanConnected(data.connected || false);
      } catch {
        setPostmanConnected(false);
      }
    };

    checkPostmanStatus();
    const onFocus = () => {
      void checkPostmanStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);


  const handleExportCollectionsToPostman = async (selectedCollectionIds: string[]) => {
    if (!postmanConnected) {
      toast({ title: t("collections.toast.postmanNotConnected"), variant: "destructive" });
      return;
    }

    const selectedCollections = collections.filter((collection) =>
      selectedCollectionIds.includes(collection.id),
    );

    if (!selectedCollections.length) {
      toast({ title: t("collections.toast.noCollectionSelected"), variant: "destructive" });
      return;
    }

    setExportingPostman(true);
    try {
      const response = await fetch("/api/postman-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:
            selectedCollections.length === 1
              ? `Export Reqly - ${selectedCollections[0].name}`
              : `Export Reqly - ${selectedCollections.length} collections`,
          description:
            selectedCollections.length === 1
              ? t("collections.toast.postmanExportDescOne", {
                  name: selectedCollections[0].name,
                })
              : t("collections.toast.postmanExportDescMany", {
                  count: selectedCollections.length,
                }),
          requests: selectedCollections.flatMap((collection) =>
            collection.requests.map((request) => ({
              collectionName: collection.name,
              name: request.name,
              method: request.method,
              url: request.url || request.endpoint || "/",
              headers: request.headers || {},
              body: request.body || "",
            })),
          ),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        // 409 : le serveur ne trouve pas de clé Postman (session expirée,
        // cookie effacé ou desktop statique) → inviter à connecter Postman.
        if (response.status === 409 || error.error === "postman_not_connected") {
          toast({
            title: t("collections.toast.postmanNotConnected"),
            description: t("collections.toast.postmanExportConnectFirst"),
            variant: "destructive",
            meta: { event: "importExport" },
          });
          return;
        }
        throw new Error(error.message || t("collections.toast.postmanExportError"));
      }

      const data = await response.json();
      toast({
        title: t("collections.toast.postmanExportSuccess"),
        description: data.postmanUid
          ? t("collections.toast.postmanExportUid", { uid: String(data.postmanUid) })
          : data.message || t("collections.toast.postmanCollectionCreated"),
        meta: { event: "importExport" },
      });
    } catch (err) {
      toast({
        title: t("common.error"),
        description:
          err instanceof Error ? err.message : t("collections.toast.postmanExportFailed"),
        variant: "destructive",
        meta: { event: "importExport" },
      });
    } finally {
      setExportingPostman(false);
    }
  };

  const handleSelectRequest = (request: RequestItem) => {
    setPendingCollectionRequest({
      id: request.id,
      name: request.name,
      method: request.method,
      url: request.url,
      endpoint: request.endpoint,
      headers: request.headers,
      body: request.body,
      bodyType: request.bodyType,
      authType: request.authType,
      authToken: request.authToken,
      queryParams: request.queryParams,
      pathParams: request.pathParams,
      runnerAssertions: request.runnerAssertions,
      preRequestScript: request.preRequestScript,
      postResponseScript: request.postResponseScript,
      datasetKey: request.datasetKey,
      protocol: request.protocol,
      graphql: request.graphql,
    });
    toast({ title: t("collections.toast.requestLoaded") });
    router.push("/");
  };

  const handleSelectAndSendRequest = (request: RequestItem) => {
    setPendingCollectionRequest({
      id: request.id,
      name: request.name,
      method: request.method,
      url: request.url,
      endpoint: request.endpoint,
      headers: request.headers,
      body: request.body,
      bodyType: request.bodyType,
      authType: request.authType,
      authToken: request.authToken,
      queryParams: request.queryParams,
      pathParams: request.pathParams,
      runnerAssertions: request.runnerAssertions,
      preRequestScript: request.preRequestScript,
      postResponseScript: request.postResponseScript,
      datasetKey: request.datasetKey,
      protocol: request.protocol,
      graphql: request.graphql,
      sendImmediately: true,
    });
    toast({ title: t("collections.toast.requestLoadedAndSent", { name: request.name }) });
    router.push("/");
  };

  const handleRunCollection = (collection: Collection) => {
    setPendingCollectionRequest({
      name: collection.name,
      method: "GET",
      url: "",
      endpoint: "/",
      collectionId: collection.id,
      sendImmediately: true,
    } as PendingCollectionRequest);
    router.push("/");
  };

  const existingCollectionNames = collections.map((c) => c.name);

  const handleImportOpenApi = (
    incomingCollections: Array<{
      name: string;
      description?: string;
      color: string;
      icon: string;
      folders?: Array<{ id: string; name: string; parentId?: string | null }>;
      requests: Array<{
        name: string;
        method: string;
        url: string;
        endpoint: string;
        headers?: Record<string, string>;
        body?: string;
        bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
        authType?: "none" | "bearer" | "basic" | "api-key" | "oauth2";
        authToken?: string;
        queryParams?: Array<{ key: string; value: string }>;
        runnerAssertions?: RequestItem["runnerAssertions"];
        preRequestScript?: string;
        postResponseScript?: string;
        folderId?: string | null;
      }>;
    }>,
  ) => {
    let createdCount = 0;
    let firstCreatedId: string | null = null;
    for (const col of incomingCollections) {
      const uniqueName = resolveUniqueCollectionName(col.name, existingCollectionNames);
      existingCollectionNames.push(uniqueName);
      const newCollectionId = addCollection({
        name: uniqueName,
        color: col.color || "emerald",
        icon: col.icon || "package",
        description: col.description,
      });
      if (firstCreatedId === null) firstCreatedId = newCollectionId;

      const tempToRealFolderId = new Map<string, string>();
      for (const folder of col.folders ?? []) {
        const realId = addFolder(newCollectionId, folder.name, folder.parentId ?? null);
        tempToRealFolderId.set(folder.id, realId);
      }

      for (const req of col.requests) {
        const folderId = req.folderId ? (tempToRealFolderId.get(req.folderId) ?? null) : null;
        addRequestToCollection(newCollectionId, {
          name: req.name,
          method: (req.method as HttpMethod) || "GET",
          url: req.url,
          endpoint: req.endpoint,
          headers: req.headers || {},
          body: req.body ?? "",
          bodyType: req.bodyType,
          authType: req.authType,
          authToken: req.authToken,
          queryParams: req.queryParams || [],
          runnerAssertions: req.runnerAssertions,
          preRequestScript: req.preRequestScript,
          postResponseScript: req.postResponseScript,
          folderId,
        });
        createdCount++;
      }
    }

    toast({
      title: t("collections.toast.openApiImportDone"),
      description: t("collections.toast.openApiImportDetails", {
        count: createdCount,
        collections: incomingCollections.length,
      }),
      meta: { event: "importExport" },
    });

    // R11 — orienter l'utilisateur vers la première collection créée
    if (firstCreatedId !== null) setHighlightedCollectionId(firstCreatedId);
  };

  const handleExportOpenApi = async (exportOptions?: { inferFromHistory?: boolean }) => {
    setExportingOpenApi(true);
    const historyItems = exportOptions?.inferFromHistory
      ? history.map((h) => ({ requestId: h.id, responseBody: h.responseBody }))
      : undefined;
    const spec = generateOpenApiSpec(collections, {
      enableInference: exportOptions?.inferFromHistory,
      historyItems,
    });
    const contents = JSON.stringify(spec, null, 2);

    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        const handle = await (
          window as unknown as {
            showSaveFilePicker: (opts: unknown) => Promise<{
              createWritable: () => Promise<{
                write: (c: string) => Promise<void>;
                close: () => Promise<void>;
              }>;
            }>;
          }
        ).showSaveFilePicker({
          suggestedName: "reqly-openapi.json",
          types: [
            {
              description: "JSON OpenAPI file",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
        setExportingOpenApi(false);
        return;
      } catch (err) {
        // R8bis — annulation utilisateur : sortie propre, pas de téléchargement
        if ((err as DOMException | undefined)?.name === "AbortError") {
          toast({
            title: t(PAGE_KEYS.exportCancelled, { defaultValue: "Export annulé" }),
            meta: { event: "importExport" },
          });
          setExportingOpenApi(false);
          return;
        }
        // Autres erreurs : fallback téléchargement navigateur ci-dessous
      }
    }

    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "reqly-openapi.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportingOpenApi(false);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("collections.title")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">{t("collections.description")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setImportChoiceOpen(true)} className="h-8 gap-1.5 text-xs font-medium">
            <Upload className="size-3.5" />
            {t("collections.import", { defaultValue: "Importer" })}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExportChoiceOpen(true)} className="h-8 gap-1.5 text-xs font-medium">
            <Download className="size-3.5" />
            {t("collections.export", { defaultValue: "Exporter" })}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => addCollection({ name: "New Collection", color: "emerald", icon: "package" })}
            className="h-8 gap-1.5 px-3 text-xs font-medium"
          >
            <Plus className="size-3.5" />
            {t("collections.panel.new", { defaultValue: "Nouvelle Collection" })}
          </Button>
        </div>
      </div>

      {/* Modal choix import */}
      <Dialog open={importChoiceOpen} onOpenChange={setImportChoiceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{t("collections.import", { defaultValue: "Importer" })}</DialogTitle>
            <DialogDescription className="text-xs">{t("collections.importChoiceDesc", { defaultValue: "Choisissez le format d'importation" })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2.5 h-11 text-sm"
              onClick={() => {
                setImportChoiceOpen(false);
                setOpenApiImportOpen(true);
              }}
            >
              <FileJson className="size-4 text-blue-600" />
              <span className="flex flex-col items-start leading-none">
                <span className="font-medium">OpenAPI</span>
                <span className="text-[11px] text-muted-foreground">Spec JSON / YAML</span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2.5 h-11 text-sm"
              onClick={() => {
                setImportChoiceOpen(false);
                setGitlabImportOpen(true);
              }}
            >
              <GitFork className="size-4 text-orange-600" />
              <span className="flex flex-col items-start leading-none">
                <span className="font-medium">GitLab</span>
                <span className="text-[11px] text-muted-foreground">API collections</span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2.5 h-11 text-sm"
              onClick={() => {
                setImportChoiceOpen(false);
                setBrunoImportOpen(true);
              }}
            >
              <Upload className="size-4 text-emerald-600" />
              <span className="flex flex-col items-start leading-none">
                <span className="font-medium">Bruno</span>
                <span className="text-[11px] text-muted-foreground">Dossier Bruno</span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2.5 h-11 text-sm"
              onClick={() => {
                setImportChoiceOpen(false);
                setPostmanManageOpen(true);
              }}
            >
              <Package className="size-4 text-violet-600" />
              <span className="flex flex-col items-start leading-none">
                <span className="font-medium">Postman</span>
                <span className="text-[11px] text-muted-foreground">Collection / Workspace</span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal choix export */}
      <Dialog open={exportChoiceOpen} onOpenChange={setExportChoiceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{t("collections.export", { defaultValue: "Exporter" })}</DialogTitle>
            <DialogDescription className="text-xs">{t("collections.exportChoiceDesc", { defaultValue: "Choisissez le format d'exportation" })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2.5 h-11 text-sm"
              onClick={() => {
                setExportChoiceOpen(false);
                setOpenApiExportOpen(true);
              }}
            >
              {exportingOpenApi ? <Loader2 className="size-4 animate-spin" /> : <FileJson className="size-4 text-blue-600" />}
              <span className="flex flex-col items-start leading-none">
                <span className="font-medium">OpenAPI</span>
                <span className="text-[11px] text-muted-foreground">Spec JSON</span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2.5 h-11 text-sm"
              disabled={!postmanConnected || exportingPostman}
              onClick={() => {
                setExportChoiceOpen(false);
                setPostmanExportOpen(true);
              }}
            >
              {exportingPostman ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4 text-violet-600" />}
              <span className="flex flex-col items-start leading-none">
                <span className="font-medium">Postman</span>
                <span className="text-[11px] text-muted-foreground">
                  {postmanConnected ? "Vers workspace" : "Non connecté"}
                </span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ImportOpenApiModal
        open={openApiImportOpen}
        onClose={() => setOpenApiImportOpen(false)}
        onImport={handleImportOpenApi}
        existingCollectionNames={collections.map((c) => c.name)}
      />

      <ImportBrunoModal
        open={brunoImportOpen}
        onClose={() => setBrunoImportOpen(false)}
        onImport={handleImportOpenApi}
      />

      <GitLabImportModal
        open={gitlabImportOpen}
        onClose={() => setGitlabImportOpen(false)}
        onImport={handleImportOpenApi}
      />

      <OpenApiExportModal
        open={openApiExportOpen}
        onClose={() => setOpenApiExportOpen(false)}
        collections={collections}
        historyItems={history.map((h) => ({ requestId: h.id, responseBody: h.responseBody }))}
        onExport={async ({ inferFromHistory }) => {
          await handleExportOpenApi({ inferFromHistory });
        }}
      />

      <PostmanManageModal
        open={postmanManageOpen}
        onOpenChange={setPostmanManageOpen}
        isConnected={postmanConnected}
        onSelectCollection={(col) => {
          setSelectedPostmanCollection({ id: col.id, name: col.name });
          setPostmanManageOpen(false);
          setPostmanImportPreviewOpen(true);
        }}
        onGoToSettings={() => {
          setPostmanManageOpen(false);
          router.push("/settings#integrations");
        }}
      />
      <PostmanImportModal
        open={postmanImportPreviewOpen}
        onOpenChange={setPostmanImportPreviewOpen}
        collectionId={selectedPostmanCollection?.id ?? null}
        collectionName={selectedPostmanCollection?.name ?? ""}
      />

      <ExportPostmanModal
        open={postmanExportOpen}
        onClose={() => setPostmanExportOpen(false)}
        collections={collections}
        onExport={handleExportCollectionsToPostman}
        isConnected={postmanConnected}
      />

      <CollectionsPanel
        collections={collections}
        highlightCollectionId={highlightedCollectionId}
        onSelectRequest={handleSelectRequest}
        onSelectAndSendRequest={handleSelectAndSendRequest}
        onRunCollection={handleRunCollection}
        onAddCollection={(data) =>
          addCollection({
            name: data?.name ?? "New Collection",
            color: data?.color ?? "emerald",
            icon: data?.icon ?? "package",
          })
        }
        onDeleteCollection={deleteCollection}
        onDuplicateCollection={duplicateCollection}
        onReorderCollections={reorderCollections}
        onRenameCollection={(id, name) => updateCollection(id, { name })}
        onAddRequestToCollection={(collectionId, request) => {
          const defaultRequest = {
            name: "New Request",
            method: "GET" as const,
            url: "",
            endpoint: "",
            headers: {},
            body: "",
            queryParams: [],
          };
          addRequestToCollection(collectionId, request ?? defaultRequest);
        }}
        onRemoveRequestFromCollection={removeRequestFromCollection}
        onAddFolder={addFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onMoveRequestToFolder={moveRequestToFolder}
        onMoveFolder={moveFolder}
        onReorderRequestsInCollection={reorderRequestsInCollection}
        onReorderFolders={reorderFolders}
        onMoveBetweenCollections={moveRequestBetweenCollections}
      />
    </main>
  );
}
