"use client"

import { useCallback, useRef, useState } from "react"
import type {
  GraphQLExecuteResult,
  GraphqlSubscriptionMessage,
  GraphqlTab,
} from "@/lib/types"
import { executeGraphQL } from "@/lib/graphql/execute"
import { subscribeGraphQL } from "@/lib/graphql/subscribe"
import { introspectSchema } from "@/lib/graphql/introspect"
import { formatGraphQL } from "@/lib/graphql/format"

const DEFAULT_ENDPOINT = "https://countries.trevorblades.com/"
const DEFAULT_QUERY = `# Welcome to Reqly GraphQL Explorer
# Click "Send" to run, or "Refresh Schema" after setting an endpoint.

query GetExample {
  __typename
}`

function makeId() {
  return `gql-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeDefaultTab(): GraphqlTab {
  return {
    id: makeId(),
    name: "Untitled GraphQL",
    endpoint: DEFAULT_ENDPOINT,
    query: DEFAULT_QUERY,
    variables: "{}",
    headers: "{}",
  }
}

export interface UseGraphqlTabsState {
  tabs: GraphqlTab[]
  activeTabId: string
  activeTab: GraphqlTab
  setActiveTabId: (id: string) => void
  updateTab: (id: string, patch: Partial<GraphqlTab>) => void
  addNewTab: () => void
  closeTab: (id: string) => void
  duplicateTab: (id: string) => void
  runQuery: () => Promise<void>
  stopSubscription: () => void
  introspect: () => Promise<void>
  prettify: () => void
  isLoading: boolean
  loadGraphqlRequest: (req: {
    name: string
    endpoint: string
    query: string
    variables: string
    headers: string
    operationName?: string
  }) => void
}

export function useGraphqlTabsState(): UseGraphqlTabsState {
  const initial = makeDefaultTab()
  const [tabs, setTabs] = useState<GraphqlTab[]>([initial])
  const [activeTabId, setActiveTabId] = useState(initial.id)
  const [isLoading, setIsLoading] = useState(false)
  const subscriptionRef = useRef<{ close: () => void } | null>(null)
  const messageCounter = useRef(0)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  const updateTab = useCallback(
    (id: string, patch: Partial<GraphqlTab>) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch, dirty: true } : t)),
      )
    },
    [],
  )

  const addNewTab = useCallback(() => {
    const newTab = makeDefaultTab()
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev
        const remaining = prev.filter((t) => t.id !== id)
        if (id === activeTabId) {
          const idx = prev.findIndex((t) => t.id === id)
          const fallback = remaining[Math.max(0, idx - 1)] ?? remaining[0]
          if (fallback) setActiveTabId(fallback.id)
        }
        return remaining
      })
    },
    [activeTabId],
  )

  const duplicateTab = useCallback(
    (id: string) => {
      const source = tabs.find((t) => t.id === id)
      if (!source) return
      const copy: GraphqlTab = {
        ...source,
        id: makeId(),
        name: `${source.name} (copy)`,
        saved: false,
        dirty: true,
        response: undefined,
        subscriptionMessages: undefined,
      }
      setTabs((prev) => [...prev, copy])
      setActiveTabId(copy.id)
    },
    [tabs],
  )

  const loadGraphqlRequest = useCallback(
    (req: {
      name: string
      endpoint: string
      query: string
      variables: string
      headers: string
      operationName?: string
    }) => {
      const newTab: GraphqlTab = {
        id: makeId(),
        name: req.name,
        endpoint: req.endpoint,
        query: req.query,
        variables: req.variables || "{}",
        headers: req.headers || "{}",
        operationName: req.operationName,
        saved: true,
        dirty: false,
      }
      setTabs((prev) => [...prev, newTab])
      setActiveTabId(newTab.id)
    },
    [],
  )

  const runQuery = useCallback(async () => {
    if (!activeTab.endpoint || !activeTab.query.trim()) return

    let parsedVars: Record<string, unknown> = {}
    let parsedHeaders: Record<string, string> = {}
    try {
      if (activeTab.variables.trim() && activeTab.variables.trim() !== "{}") {
        parsedVars = JSON.parse(activeTab.variables)
      }
      if (activeTab.headers.trim() && activeTab.headers.trim() !== "{}") {
        parsedHeaders = JSON.parse(activeTab.headers)
      }
    } catch {
      updateTab(activeTab.id, {
        response: {
          statusCode: 400,
          responseTimeMs: 0,
          headers: {},
          graphqlBody: {},
          errors: [{ message: "Invalid JSON in variables or headers" }],
        } satisfies GraphQLExecuteResult,
      })
      return
    }

    const isSubscription = /\bsubscription\b/.test(activeTab.query)
    if (isSubscription) {
      messageCounter.current = 0
      updateTab(activeTab.id, { subscriptionMessages: [], response: undefined })
      try {
        const handle = subscribeGraphQL(
          activeTab.endpoint,
          activeTab.query,
          parsedVars,
          parsedHeaders,
          (msg) => {
            messageCounter.current += 1
            const m: GraphqlSubscriptionMessage = {
              id: messageCounter.current,
              type: msg.type as GraphqlSubscriptionMessage["type"],
              payload: msg.payload,
              timestamp: Date.now(),
            }
            setTabs((prev) =>
              prev.map((t) =>
                t.id === activeTab.id
                  ? {
                      ...t,
                      subscriptionMessages: [
                        ...(t.subscriptionMessages ?? []),
                        m,
                      ],
                    }
                  : t,
              ),
            )
          },
        )
        subscriptionRef.current = handle
      } catch (e) {
        updateTab(activeTab.id, {
          response: {
            statusCode: 0,
            responseTimeMs: 0,
            headers: {},
            graphqlBody: {},
            errors: [
              {
                message: e instanceof Error ? e.message : "Subscription failed",
              },
            ],
          } satisfies GraphQLExecuteResult,
        })
      }
      return
    }

    setIsLoading(true)
    updateTab(activeTab.id, { schemaLoading: true, response: undefined })
    const started = Date.now()
    try {
      const result = await executeGraphQL({
        endpoint: activeTab.endpoint,
        query: activeTab.query,
        variables: parsedVars,
        headers: parsedHeaders,
      })
      updateTab(activeTab.id, { response: result, schemaLoading: false })
    } catch (e) {
      updateTab(activeTab.id, {
        response: {
          statusCode: 0,
          responseTimeMs: Date.now() - started,
          headers: {},
          graphqlBody: {},
          errors: [
            { message: e instanceof Error ? e.message : "Network error" },
          ],
        } satisfies GraphQLExecuteResult,
        schemaLoading: false,
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeTab, updateTab])

  const stopSubscription = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close()
      subscriptionRef.current = null
    }
  }, [])

  const introspect = useCallback(async () => {
    if (!activeTab.endpoint) return
    updateTab(activeTab.id, { schemaLoading: true })
    try {
      const sdl = await introspectSchema(activeTab.endpoint)
      const parsed = JSON.parse(sdl) as { __schema?: unknown }
      updateTab(activeTab.id, {
        schema: parsed.__schema ?? null,
        schemaLoading: false,
      })
    } catch (e) {
      updateTab(activeTab.id, {
        schemaLoading: false,
        response: {
          statusCode: 0,
          responseTimeMs: 0,
          headers: {},
          graphqlBody: {},
          errors: [
            {
              message:
                e instanceof Error ? e.message : "Introspection failed",
            },
          ],
        } satisfies GraphQLExecuteResult,
      })
    }
  }, [activeTab, updateTab])

  const prettify = useCallback(() => {
    updateTab(activeTab.id, { query: formatGraphQL(activeTab.query) })
  }, [activeTab, updateTab])

  return {
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
  }
}
