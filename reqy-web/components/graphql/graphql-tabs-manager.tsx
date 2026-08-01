"use client";

import { useCallback, useState } from "react";
import { useGraphqlTabsState } from "@/hooks/use-graphql-tabs-state";
import { useGraphqlAI } from "@/hooks/use-graphql-ai";
import { useRequestStore } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
import { GraphqlTabBar } from "./graphql-tab-bar";
import { GraphqlActiveToolbar } from "./graphql-active-toolbar";
import { GraphqlRequestPanel } from "./graphql-request-panel";
import { GraphqlResponsePanel } from "./graphql-response-panel";
import { SchemaDocPanel } from "./graphql-schema-doc-panel";
import { GraphqlAIDialog } from "./graphql-ai-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { CollectionsModal } from "@/components/collections-modal";
import { RequestSaveDialog } from "@/components/request-save-dialog";
import { toast } from "@/hooks/use-toast";

export function GraphqlTabsManager() {
  const {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    updateTab,
    addNewTab,
    closeTab,
    duplicateTab,
    runQuery,
    stopSubscription,
    introspect,
    prettify,
    isLoading,
    loadGraphqlRequest,
  } = useGraphqlTabsState();

  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveCollectionId, setSaveCollectionId] = useState<string>("none");
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [schemaDocOpen, setSchemaDocOpen] = useState(false);

  // Was: 3× `useRequestStore().x` — each call re-subscribed to the whole
  // store. Atomic selector for data + grouped actions via useShallow.
  const collections = useRequestStore((s) => s.collections);
  const {
    addCollection,
    addRequestToCollection,
    deleteCollection,
    updateCollection,
    removeRequestFromCollection,
  } = useRequestStore(
    useShallow((s) => ({
      addCollection: s.addCollection,
      addRequestToCollection: s.addRequestToCollection,
      deleteCollection: s.deleteCollection,
      updateCollection: s.updateCollection,
      removeRequestFromCollection: s.removeRequestFromCollection,
    })),
  );

  const { assistGraphql, fixGraphqlError, isLoading: aiLoading, error: aiError } = useGraphqlAI();

  const handleSave = useCallback(() => {
    setSaveName(activeTab.name);
    setSaveCollectionId("none");
    setSaveOpen(true);
  }, [activeTab]);

  const handleSaveSubmit = useCallback(() => {
    const payload = {
      name: saveName.trim() || activeTab.name,
      method: "GRAPHQL" as const,
      url: activeTab.endpoint,
      endpoint: activeTab.endpoint,
      protocol: "graphql" as const,
      graphql: {
        query: activeTab.query,
        variables: activeTab.variables,
        operationName: activeTab.operationName,
      },
      headers: (() => {
        try {
          return JSON.parse(activeTab.headers || "{}");
        } catch {
          return {};
        }
      })(),
      body: "",
      bodyType: "raw" as const,
      authType: "none" as const,
      queryParams: [],
    };
    if (saveCollectionId !== "none") {
      addRequestToCollection(saveCollectionId, payload);
      toast({
        title: "Saved to collection",
        description: payload.name,
      });
    } else {
      toast({
        title: "Draft saved",
        description: "Open a collection to persist this request.",
      });
    }
    updateTab(activeTab.id, { saved: true, dirty: false, name: payload.name });
    setSaveOpen(false);
  }, [saveName, activeTab, saveCollectionId, addRequestToCollection, updateTab]);

  const handleExport = useCallback(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            endpoint: activeTab.endpoint,
            query: activeTab.query,
            variables: activeTab.variables,
            headers: activeTab.headers,
            operationName: activeTab.operationName,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab.name.replace(/[^a-z0-9-_]/gi, "_")}.graphql.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeTab]);

  const handleAiAssist = useCallback(() => {
    setAiDialogOpen(true);
  }, []);

  const handleAiSubmit = useCallback(
    async (description: string) => {
      const result = await assistGraphql({
        description,
        schema: activeTab.schema,
        currentQuery: activeTab.query,
        applyQuery: (q) => updateTab(activeTab.id, { query: q }),
      });
      if (result) {
        setAiDialogOpen(false);
      }
    },
    [activeTab, updateTab, assistGraphql],
  );

  const handleAiFix = useCallback(async () => {
    const errMsg =
      (activeTab.response?.errors && activeTab.response.errors[0]?.message) ||
      "Unknown GraphQL error";
    await fixGraphqlError({
      query: activeTab.query,
      errorMessage: errMsg,
      applyQuery: (q) => updateTab(activeTab.id, { query: q }),
    });
  }, [activeTab, updateTab, fixGraphqlError]);

  const handleSelectFromCollection = useCallback(
    (req: import("@/lib/types").RequestItem) => {
      if (req.protocol === "graphql" && req.graphql) {
        loadGraphqlRequest({
          name: req.name,
          endpoint: req.url,
          query: req.graphql.query,
          variables: req.graphql.variables,
          headers: JSON.stringify(req.headers ?? {}),
          operationName: req.graphql.operationName,
        });
        toast({ title: "Loaded", description: req.name });
      } else {
        toast({
          title: "Not a GraphQL request",
          description: "Pick a request saved as GraphQL.",
          variant: "destructive",
        });
      }
      setCollectionsOpen(false);
    },
    [loadGraphqlRequest],
  );

  const variablesForRequest = (() => {
    try {
      return JSON.parse(activeTab.variables || "{}");
    } catch {
      return {};
    }
  })();
  const headersForRequest = (() => {
    try {
      return JSON.parse(activeTab.headers || "{}");
    } catch {
      return {};
    }
  })();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <GraphqlTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onAdd={addNewTab}
        onClose={closeTab}
        onDuplicate={duplicateTab}
      />
      <GraphqlActiveToolbar
        activeTab={activeTab}
        onNameChange={(name) => updateTab(activeTab.id, { name })}
        onSave={handleSave}
        onRun={runQuery}
        onStop={stopSubscription}
        onExport={handleExport}
        onAiAssist={handleAiAssist}
        onAiFix={handleAiFix}
        aiLoading={aiLoading}
        aiError={aiError ?? null}
        onLoadFromCollection={() => setCollectionsOpen(true)}
        running={isLoading || !!activeTab.schemaLoading}
      />
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={55} minSize={25} className="min-w-0 min-h-0 overflow-hidden">
          <GraphqlRequestPanel
            tab={activeTab}
            onUpdate={(patch) => updateTab(activeTab.id, patch)}
            onSend={runQuery}
            onStop={stopSubscription}
            onIntrospect={introspect}
            onPrettify={prettify}
            onToggleSchema={() => setSchemaDocOpen((o) => !o)}
            schemaOpen={schemaDocOpen}
            running={isLoading || !!activeTab.schemaLoading}
          />
        </ResizablePanel>
        <ResizableHandle withHandle className="bg-border" />
        <ResizablePanel defaultSize={45} minSize={25} className="min-w-0 min-h-0 overflow-hidden">
          <GraphqlResponsePanel
            response={activeTab.response}
            error={activeTab.response?.errors?.[0]?.message}
            subscriptionMessages={activeTab.subscriptionMessages}
            loading={isLoading || !!activeTab.schemaLoading}
            onStop={stopSubscription}
            request={{
              endpoint: activeTab.endpoint,
              query: activeTab.query,
              variables: variablesForRequest,
              operationName: activeTab.operationName,
              headers: headersForRequest,
            }}
            schema={activeTab.schema}
            endpoint={activeTab.endpoint}
            operationName={activeTab.operationName}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {schemaDocOpen && (
        <SchemaDocPanel schema={activeTab.schema} onClose={() => setSchemaDocOpen(false)} />
      )}

      <CollectionsModal
        open={collectionsOpen}
        onOpenChange={setCollectionsOpen}
        collections={collections}
        onSelectRequest={handleSelectFromCollection}
        onAddCollection={(data) =>
          addCollection({
            name: data?.name ?? "New Collection",
            color: data?.color ?? "emerald",
            icon: data?.icon ?? "package",
          })
        }
        onDeleteCollection={deleteCollection}
        onRenameCollection={(id, name) => updateCollection(id, { name })}
        onAddRequestToCollection={(collectionId, request) => {
          if (request) addRequestToCollection(collectionId, request);
        }}
        onRemoveRequestFromCollection={removeRequestFromCollection}
      />

      <RequestSaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        name={saveName}
        onNameChange={setSaveName}
        collectionId={saveCollectionId}
        onCollectionIdChange={setSaveCollectionId}
        collections={collections}
        onSubmit={handleSaveSubmit}
      />

      <GraphqlAIDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        onSubmit={handleAiSubmit}
        loading={aiLoading}
        error={aiError}
        hasSchema={!!activeTab.schema}
      />
    </div>
  );
}
