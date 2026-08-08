"use client";

import { CollectionsPanel } from "@/components/collections-panel";
import { ImportPostmanModal as LegacyImportPostmanModal } from "@/components/import-postman-modal";
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
import { Loader2, Upload, Download, FileJson, GitFork, Package, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export default function CollectionsPage() {
  const router = useRouter();
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

  const [postmanImportOpen, setPostmanImportOpen] = useState(false);
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

  const handleImportPostmanCollection = (collection: {
    name: string;
    description?: string;
    routes?: unknown[];
    requests?: Partial<RequestItem>[];
  }) => {
    const uniqueName = resolveUniqueCollectionName(
      collection.name,
      collections.map((c) => c.name),
    );
    const newCollectionId = addCollection({
      name: uniqueName,
      color: "emerald",
      icon: "package",
      description: collection.description,
    });

    const source =
      collection.requests && collection.requests.length > 0
        ? collection.requests
        : (collection.routes ?? []);

    source.forEach((item) => {
      const route = item as {
        method?: string;
        path?: string;
        url?: string;
        name?: string;
        headers?: Record<string, string>;
        body?: string;
        bodyType?: RequestItem["bodyType"];
        authType?: RequestItem["authType"];
        authToken?: string;
        queryParams?: RequestItem["queryParams"];
      };
      const method = (route.method || "GET") as HttpMethod;
      const path = route.path || route.url || "/";
      addRequestToCollection(newCollectionId, {
        name: route.name || `${method} ${path}`,
        method,
        url: path,
        endpoint: path,
        headers: route.headers || {},
        body: route.body ?? "",
        bodyType: route.bodyType,
        authType: route.authType,
        authToken: route.authToken,
        queryParams: route.queryParams || [],
      });
    });

    toast({
      title: `Collection Postman importée: ${uniqueName}`,
      description:
        uniqueName !== collection.name
          ? `Renommée depuis « ${collection.name} » (conflit de nom).`
          : undefined,
    });
  };

  const handleExportCollectionsToPostman = async (selectedCollectionIds: string[]) => {
    if (!postmanConnected) {
      toast({ title: "Postman non connecté", variant: "destructive" });
      return;
    }

    const selectedCollections = collections.filter((collection) =>
      selectedCollectionIds.includes(collection.id),
    );

    if (!selectedCollections.length) {
      toast({ title: "Aucune collection sélectionnée", variant: "destructive" });
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
              ? `Collection exportée depuis Reqly : ${selectedCollections[0].name}`
              : `Export de ${selectedCollections.length} collections depuis Reqly`,
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
        throw new Error(error.message || "Erreur lors de l'export vers Postman");
      }

      const data = await response.json();
      toast({
        title: "Export vers Postman réussi",
        description: data.message || "Collection créée dans Postman",
        meta: { event: "importExport" },
      });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible d'exporter vers Postman",
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
      assertions: request.assertions,
      runnerAssertions: request.runnerAssertions,
      preRequestScript: request.preRequestScript,
      postResponseScript: request.postResponseScript,
      datasetKey: request.datasetKey,
      protocol: request.protocol,
      graphql: request.graphql,
    });
    toast({ title: "Requête chargée dans l'éditeur" });
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
      assertions: request.assertions,
      runnerAssertions: request.runnerAssertions,
      preRequestScript: request.preRequestScript,
      postResponseScript: request.postResponseScript,
      datasetKey: request.datasetKey,
      protocol: request.protocol,
      graphql: request.graphql,
      sendImmediately: true,
    });
    toast({ title: `"${request.name}" loaded and sent` });
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
        assertions?: RequestItem["assertions"];
        runnerAssertions?: RequestItem["runnerAssertions"];
        preRequestScript?: string;
        postResponseScript?: string;
      }>;
    }>,
  ) => {
    let createdCount = 0;
    for (const col of incomingCollections) {
      const uniqueName = resolveUniqueCollectionName(col.name, existingCollectionNames);
      existingCollectionNames.push(uniqueName);
      const newCollectionId = addCollection({
        name: uniqueName,
        color: col.color || "emerald",
        icon: col.icon || "package",
        description: col.description,
      });

      for (const req of col.requests) {
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
          assertions: req.assertions,
          runnerAssertions: req.runnerAssertions,
          preRequestScript: req.preRequestScript,
          postResponseScript: req.postResponseScript,
        });
        createdCount++;
      }
    }

    toast({
      title: `Import OpenAPI terminé`,
      description: `${createdCount} requête${createdCount > 1 ? "s" : ""} importée${createdCount > 1 ? "s" : ""} dans ${incomingCollections.length} collection${incomingCollections.length > 1 ? "s" : ""}.`,
      meta: { event: "importExport" },
    });
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
      } catch {
        // If user cancels save dialog or browser doesn't support it, fallback to download
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
    <main className="flex-1 overflow-auto">
      <div className="flex flex-col gap-4 border-b border-border bg-background/80 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="shrink-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Collections</h1>
          <p className="text-sm text-muted-foreground">
            Gérez vos groupes de requêtes et exportez-les en OpenAPI.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              Importer
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenApiImportOpen(true)}
              className="border-blue-200/40 text-blue-700 transition-all duration-150 hover:scale-105 hover:bg-blue-50 hover:text-blue-800 hover:shadow-sm active:scale-95 dark:border-blue-800/30 dark:text-blue-400 dark:hover:bg-blue-950/50"
            >
              <FileJson className="mr-1.5 size-3.5" />
              OpenAPI
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGitlabImportOpen(true)}
              className="border-orange-200/40 text-orange-700 transition-all duration-150 hover:scale-105 hover:bg-orange-50 hover:text-orange-800 hover:shadow-sm active:scale-95 dark:border-orange-800/30 dark:text-orange-400 dark:hover:bg-orange-950/50"
            >
              <GitFork className="mr-1.5 size-3.5" />
              GitLab
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBrunoImportOpen(true)}
              className="border-emerald-200/40 text-emerald-700 transition-all duration-150 hover:scale-105 hover:bg-emerald-50 hover:text-emerald-800 hover:shadow-sm active:scale-95 dark:border-emerald-800/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
            >
              <Upload className="mr-1.5 size-3.5" />
              Bruno
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-violet-200/40 text-violet-700 transition-all duration-150 hover:scale-105 hover:bg-violet-50 hover:text-violet-800 hover:shadow-sm active:scale-95 data-[state=open]:scale-105 data-[state=open]:bg-violet-50 dark:border-violet-800/30 dark:text-violet-400 dark:hover:bg-violet-950/50"
                >
                  <Package className="mr-1.5 size-3.5" />
                  Postman
                  <ChevronDown className="ml-1 size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setPostmanManageOpen(true)}>
                  <Upload className="mr-2 size-4" />
                  Importer depuis Postman
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPostmanExportOpen(true)}
                  disabled={!postmanConnected || exportingPostman}
                >
                  {exportingPostman ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 size-4" />
                  )}
                  {exportingPostman ? "Export en cours..." : "Exporter vers Postman"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              Exporter
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenApiExportOpen(true)}
              className="border-blue-200/40 text-blue-700 transition-all duration-150 hover:scale-105 hover:bg-blue-50 hover:text-blue-800 hover:shadow-sm active:scale-95 dark:border-blue-800/30 dark:text-blue-400 dark:hover:bg-blue-950/50"
            >
              {exportingOpenApi ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 size-3.5" />
              )}
              {exportingOpenApi ? "Export..." : "OpenAPI"}
            </Button>
          </div>
        </div>
      </div>

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

      <LegacyImportPostmanModal
        open={postmanImportOpen}
        onClose={() => setPostmanImportOpen(false)}
        onImport={handleImportPostmanCollection}
        isConnected={postmanConnected}
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
