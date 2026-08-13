"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Server, Play, Square, Terminal, Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMcpServer } from "@/hooks/use-mcp-server";
import { useRequestStore, getGlobalStore, moduleLevelCommit } from "@/hooks/use-request-store";
import { isTauriAvailable } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Collection } from "@/hooks/request-types";
import { useTranslation } from "react-i18next";

const DEFAULT_MCP_PORT = 3311;

const KNOWN_ICONS = new Set(["lock", "users", "package", "folder"]);
const KNOWN_COLORS = new Set([
  "emerald",
  "blue",
  "amber",
  "purple",
  "red",
  "pink",
  "slate",
  "indigo",
  "violet",
  "orange",
]);
const DEFAULT_ICON = "package";
const DEFAULT_COLOR = "emerald";

function normalizeIcon(icon: string | undefined): string {
  return icon && KNOWN_ICONS.has(icon) ? icon : DEFAULT_ICON;
}

function normalizeColor(color: string | undefined): string {
  return color && KNOWN_COLORS.has(color) ? color : DEFAULT_COLOR;
}

export default function McpSection() {
  const { t } = useTranslation();
  const isTauri = isTauriAvailable();
  const { status, loading, start, stop, loadBundleCollections } = useMcpServer();
  const store = useRequestStore();
  const collections = store.collections;
  const environments = store.environments;
  const addCollection = store.addCollection;
  const deleteCollection = store.deleteCollection;
  const [port, setPort] = useState(DEFAULT_MCP_PORT);
  const [copySuccess, setCopySuccess] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = `http://localhost:${status.port ?? port}/mcp`;
  const mcpUrl = status.running ? serverUrl : `http://localhost:${port}/mcp`;

  const handleToggle = async () => {
    setError(null);
    try {
      if (status.running) {
        await stop();
      } else {
        await start(Object.values(collections), Object.values(environments ?? {}), { port });
      }
    } catch (err) {
      // Tauri rejette les erreurs de commande comme des strings, pas des Error.
      const msg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : t("settings.mcp.startError");
      setError(msg);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(mcpUrl);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const syncingRef = useRef(false);

  const handleSyncFromMcp = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncSuccess(false);

    const mcpCollections = await loadBundleCollections();
    if (!mcpCollections?.length) {
      setSyncing(false);
      syncingRef.current = false;
      return;
    }

    // Fix duplicate collection IDs using moduleLevelCommit (same ID = React key collision)
    for (let pass = 0; pass < 5; pass++) {
      let fixed = false;
      const seen = new Map<string, number>();
      const store = getGlobalStore();
      for (let i = 0; i < store.collections.length; i++) {
        const c = store.collections[i];
        if (seen.has(c.id)) {
          const firstIdx = seen.get(c.id)!;
          const oldId = c.id;
          // Rename first occurrence so it survives the delete
          moduleLevelCommit((prev) => {
            const newId = `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            return {
              ...prev,
              collections: prev.collections.map((col, idx) =>
                idx === firstIdx ? { ...col, id: newId } : col,
              ),
            };
          });
          // Delete remaining with the old duplicate ID
          moduleLevelCommit((prev) => ({
            ...prev,
            collections: prev.collections.filter((col) => col.id !== oldId),
          }));
          fixed = true;
          break;
        }
        seen.set(c.id, i);
      }
      if (!fixed) break;
    }

    // Fix duplicate names (trimmed, case-insensitive)
    const seenNames = new Set<string>();
    const dupNameIds: string[] = [];
    for (const c of getGlobalStore().collections ?? []) {
      const key = c.name.trim().toLowerCase();
      if (seenNames.has(key)) dupNameIds.push(c.id);
      seenNames.add(key);
    }
    for (const id of dupNameIds) {
      deleteCollection(id);
    }

    // Build name map from current store state (after dedup)
    const existingByName = new Map(
      (getGlobalStore().collections ?? []).map((c: Collection) => [c.name.trim().toLowerCase(), c]),
    );
    const addedThisSync = new Set<string>();
    for (const mcpCol of mcpCollections) {
      const key = (mcpCol.name ?? "").trim().toLowerCase();
      if (existingByName.has(key) || addedThisSync.has(key)) continue;
      addCollection({
        name: mcpCol.name.trim(),
        description: mcpCol.description?.trim(),
        color: normalizeColor(mcpCol.color),
        icon: normalizeIcon(mcpCol.icon),
        requests: mcpCol.requests ?? [],
        folders: mcpCol.folders ?? [],
      });
      addedThisSync.add(key);
    }

    setSyncSuccess(true);
    setSyncing(false);
    syncingRef.current = false;
    setTimeout(() => setSyncSuccess(false), 3000);
  }, [loadBundleCollections, addCollection, deleteCollection]);

  // Auto-sync once when the server starts
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (status.running && !autoSyncedRef.current) {
      autoSyncedRef.current = true;
      const timer = setTimeout(() => handleSyncFromMcp(), 1000);
      return () => clearTimeout(timer);
    }
    if (!status.running) {
      autoSyncedRef.current = false;
    }
  }, [status.running, handleSyncFromMcp]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="size-10 shrink-0 flex items-center justify-center rounded-xl bg-primary/10">
            <Server className="size-5 text-primary" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-base">{t("settings.mcp.title")}</CardTitle>
            <CardDescription>{t("settings.mcp.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Status + Controls */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "size-3 rounded-full shrink-0",
                    status.running
                      ? "bg-success shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : "bg-muted-foreground/30",
                  )}
                />
                <span className="text-sm font-medium">
                  {status.running
                    ? t("settings.mcp.running", { port: status.port })
                    : t("settings.mcp.stopped")}
                </span>
                {status.running && status.pid && (
                  <span className="text-xs text-muted-foreground">(PID: {status.pid})</span>
                )}
              </div>

              {status.running && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.mcp.collectionsExposed")}
                </p>
              )}

              {!isTauri && <p className="text-xs text-warning">{t("settings.mcp.desktopOnly")}</p>}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isTauri && status.running && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSyncFromMcp}
                  disabled={syncing}
                  className="gap-2"
                >
                  <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                  {t("settings.mcp.sync")}
                </Button>
              )}
              {isTauri && (
                <Button
                  variant={status.running ? "destructive" : "default"}
                  size="sm"
                  onClick={handleToggle}
                  disabled={loading}
                  className="gap-2"
                >
                  {loading ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : status.running ? (
                    <Square className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {status.running ? t("settings.mcp.stop") : t("settings.mcp.start")}
                </Button>
              )}
            </div>
          </div>

          {syncSuccess && <p className="text-xs text-success mt-3">{t("settings.mcp.synced")}</p>}

          {error && <p className="text-xs text-destructive mt-3">{error}</p>}
        </div>

        {/* Port config */}
        {!status.running && isTauri && (
          <div className="flex items-center gap-3">
            <Label htmlFor="mcp-port" className="text-sm shrink-0">
              {t("settings.mcp.port")}
            </Label>
            <Input
              id="mcp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-24 h-8 text-sm"
              min={1024}
              max={65535}
            />
          </div>
        )}

        {/* Connection URL */}
        {status.running && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" />
              {t("settings.mcp.connectionUrl")}
            </h4>
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs font-mono text-foreground break-all select-all">
                  {serverUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={handleCopyUrl}
                  title={t("settings.mcp.copyUrl")}
                >
                  {copySuccess ? (
                    <Check className="size-3.5 text-success" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* OpenCode config hint */}
        {status.running && (
          <div className="rounded-lg bg-success/10 border border-success/20 p-3">
            <div className="flex items-start gap-2">
              <Check className="size-4 text-success mt-0.5 shrink-0" />
              <div className="text-xs text-success space-y-1">
                <p className="font-medium">{t("settings.mcp.opencodeConfig")}</p>
                <code className="block bg-success/10 rounded px-2 py-1 text-[11px]">
                  {`"mcpServers": {\n  "reqly": {\n    "url": "${serverUrl}"\n  }\n}`}
                </code>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
