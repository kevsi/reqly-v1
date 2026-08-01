"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { isTauriAvailable } from "@/lib/tauri"
import type { Collection, Environment } from "@/lib/types"

export interface McpServerStatus {
  running: boolean
  port: number | null
  pid: number | null
}

export interface McpServerConfig {
  port?: number
  envName?: string
  allowLocalHosts?: boolean
  maxResponseSize?: number
}

const MCP_DEFAULT_PORT = 3311

/**
 * Hook to control the reqy-mcp server via Tauri commands.
 */
export function useMcpServer() {
  const [status, setStatus] = useState<McpServerStatus>({
    running: false,
    port: null,
    pid: null,
  })
  const [loading, setLoading] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!isTauriAvailable()) return
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const s = await invoke<McpServerStatus>("get_mcp_server_status")
      setStatus(s)
    } catch {
      setStatus({ running: false, port: null, pid: null })
    }
  }, [])

  const start = useCallback(
    async (
      collections: Collection[],
      environments: Environment[],
      config?: McpServerConfig,
    ) => {
      if (!isTauriAvailable()) return
      setLoading(true)
      try {
        const bundle = buildBundle(collections, environments)
        const { invoke } = await import("@tauri-apps/api/core")
        const serverConfig: McpServerConfig = {
          port: config?.port ?? MCP_DEFAULT_PORT,
          ...(config?.envName !== undefined && { envName: config.envName }),
          ...(config?.allowLocalHosts !== undefined && { allowLocalHosts: config.allowLocalHosts }),
          ...(config?.maxResponseSize !== undefined && { maxResponseSize: config.maxResponseSize }),
        }
        const result = await invoke<string>("start_mcp_server", {
          bundleJson: JSON.stringify(bundle),
          config: serverConfig,
        })
        await refreshStatus()
        return result
      } finally {
        setLoading(false)
      }
    },
    [refreshStatus],
  )

  const stop = useCallback(async () => {
    if (!isTauriAvailable()) return
    setLoading(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const result = await invoke<string>("stop_mcp_server")
      setStatus({ running: false, port: null, pid: null })
      return result
    } finally {
      setLoading(false)
    }
  }, [])

  /** Read MCP collections from the bundle and return them */
  const loadBundleCollections = useCallback(async (): Promise<Collection[] | null> => {
    if (!isTauriAvailable()) return null
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const raw = await invoke<string>("read_mcp_bundle")
      if (!raw) return null
      return JSON.parse(raw).collections ?? null
    } catch {
      return null
    }
  }, [])

  /** Sync MCP collections into the app store */
  const syncIntoApp = useCallback(async () => {
    if (!isTauriAvailable()) return
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("sync_mcp_collections")
    } catch { /* ignore */ }
  }, [])

  // Listen for status events + initial fetch (runs once)
  const unlistenRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event")
      unlistenRef.current = await listen<McpServerStatus>("mcp-status", (event) => {
        setStatus(event.payload)
      })
      // Initial fetch after listener is set up
      await refreshStatus()
    }
    setup()
    return () => {
      unlistenRef.current?.()
      unlistenRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    status,
    loading,
    start,
    stop,
    refreshStatus,
    loadBundleCollections,
    syncIntoApp,
  }
}

function buildBundle(
  collections: Collection[],
  environments: Environment[],
): Record<string, unknown> {
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: collections.map((c) => ({
      ...c,
      requests: c.requests ?? [],
      folders: c.folders ?? [],
    })),
    environments: environments.map((e) => ({
      name: e.name,
      variables: e.variables ?? [],
      color: e.color,
    })),
  }
}
