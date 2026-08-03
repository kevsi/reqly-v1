"use client"

import { useCallback, useState } from "react"
import { PROMPTS } from "@/src/ai/cloud-engine/actions"
import { callAITextViaStream } from "@/src/ai/cloud-engine/text"
import { extractGraphqlReply } from "@/lib/graphql/extract-reply"
import { loadAIProvider, loadApiKey, loadOllamaConfig, loadAiBaseUrl, loadAiModel } from "@/lib/config"
import { toast } from "@/hooks/use-toast"

export interface GraphqlAIConfig {
  provider: ReturnType<typeof loadAIProvider>
  apiKey?: string
  model?: string
  openaiUrl?: string
  ollamaUrl?: string
  /** Host/port Ollama dérivés de loadOllamaConfig par parseAiConfig. */
  host?: string
  port?: number
  system?: string
}

/**
 * Override the global SYSTEM_PROMPT (which forces a JSON wrapper with a
 * summary + actions array) so the model can reply with a bare GraphQL
 * operation. We still tolerate JSON wrappers on the receive side via
 * extractGraphqlReply, in case some models refuse to drop the JSON habit.
 */
const GRAPHQL_AI_SYSTEM_PROMPT = `You are a GraphQL query generation expert.

ABSOLUTE RULES — do not violate:
- Output ONLY the GraphQL operation string (query, mutation, or subscription).
- DO NOT wrap your reply in JSON, markdown fences, or any other structure.
- DO NOT include a summary, explanation, or commentary.
- DO NOT include a code-fence language tag like \`\`\`graphql.
- The first non-whitespace character of your reply must be the keyword
  (query | mutation | subscription | fragment) or a curly brace.

Example of a correct reply:
query GetUser($id: ID!) {
  user(id: $id) {
    id
    name
    email
  }
}`


export interface UseGraphqlAIResult {
  isLoading: boolean
  error: string | null
  lastSuggestion: string | null
  /** Generate a GraphQL query from a natural language description and apply it. */
  assistGraphql: (args: {
    description: string
    schema?: unknown
    currentQuery: string
    applyQuery: (query: string) => void
  }) => Promise<string | null>
  /** Auto-fix a query that produced a server-side error. */
  fixGraphqlError: (args: {
    query: string
    errorMessage: string
    applyQuery: (query: string) => void
  }) => Promise<string | null>
}

function parseAiConfig(): GraphqlAIConfig {
  const provider = loadAIProvider()
  const apiKey = loadApiKey(provider) ?? ""
  const openaiUrl = loadAiBaseUrl(provider)
  const model = loadAiModel(provider)
  const ollamaConfig = loadOllamaConfig()

  if (!provider) {
    throw new Error("Configure ton provider IA dans Settings")
  }
  if (provider !== "ollama" && !apiKey.trim()) {
    throw new Error("Clé API manquante dans Settings")
  }

  return {
    provider,
    apiKey: apiKey.trim(),
    model:
      model?.trim() ||
      (provider === "ollama" ? ollamaConfig.model : undefined),
    openaiUrl: provider === "openai" ? openaiUrl?.trim() || undefined : undefined,
    ollamaUrl:
      provider === "ollama"
        ? `http://${ollamaConfig.host || "127.0.0.1"}:${ollamaConfig.port ?? 11434}`
        : undefined,
    host: provider === "ollama" ? ollamaConfig.host : undefined,
    port: provider === "ollama" ? ollamaConfig.port : undefined,
  }
}

/** Strip markdown code fences and surrounding prose from an LLM reply.
 *  Implementation lives in @/lib/graphql/extract-reply (with unit tests). */
void extractGraphqlReply // keep import alive for tooling / tree-shake check

export function useGraphqlAI(): UseGraphqlAIResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSuggestion, setLastSuggestion] = useState<string | null>(null)

  const assistGraphql = useCallback(
    async ({
      description,
      schema,
      applyQuery,
    }: {
      description: string
      schema?: unknown
      currentQuery: string
      applyQuery: (query: string) => void
    }) => {
      setError(null)
      setIsLoading(true)
      try {
        const config = parseAiConfig()
        const schemaHint = schema ? JSON.stringify(schema) : undefined
        const prompt = PROMPTS.graphqlFromDescription(description, schemaHint)
        const raw = await callAITextViaStream({
          provider: config.provider,
          apiKey: config.apiKey ?? "",
          model: config.model,
          openaiUrl: config.openaiUrl,
          host: config.host,
          port: config.port,
          system: GRAPHQL_AI_SYSTEM_PROMPT,
          rawMessage: prompt,
        })
        const suggestion = extractGraphqlReply(raw)
        if (!suggestion) throw new Error("Empty AI response")
        applyQuery(suggestion)
        setLastSuggestion(suggestion)
        toast({
          title: "Query generated",
          description: "Applied to the active tab.",
        })
        return suggestion
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
        toast({
          title: "AI assist failed",
          description: message,
          variant: "destructive",
        })
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  const fixGraphqlError = useCallback(
    async ({
      query,
      errorMessage,
      applyQuery,
    }: {
      query: string
      errorMessage: string
      applyQuery: (query: string) => void
    }) => {
      setError(null)
      setIsLoading(true)
      try {
        const config = parseAiConfig()
        const prompt = PROMPTS.graphqlFixFromError(query, errorMessage)
        const raw = await callAITextViaStream({
          provider: config.provider,
          apiKey: config.apiKey ?? "",
          model: config.model,
          openaiUrl: config.openaiUrl,
          host: config.host,
          port: config.port,
          system: GRAPHQL_AI_SYSTEM_PROMPT,
          rawMessage: prompt,
        })
        const suggestion = extractGraphqlReply(raw)
        if (!suggestion) throw new Error("Empty AI response")
        applyQuery(suggestion)
        setLastSuggestion(suggestion)
        return suggestion
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
        toast({
          title: "AI fix failed",
          description: message,
          variant: "destructive",
        })
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  return {
    isLoading,
    error,
    lastSuggestion,
    assistGraphql,
    fixGraphqlError,
  }
}
