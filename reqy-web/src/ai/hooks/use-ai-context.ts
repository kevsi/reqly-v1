"use client"

import { useMemo } from "react"
import { usePathname } from "next/navigation"
import { useRequestStore, type HistoryItem, type Collection } from "@/hooks/use-request-store"

export interface AiPageContext {
  /** Page label shown in the UI */
  pageLabel: string
  /** System prompt injected into the AI API call */
  systemPrompt: string
  /** Short summary shown in the chat header */
  contextSummary: string
}

function buildDashboardContext(history: HistoryItem[]): AiPageContext {
  const totalRequests = history.length
  const successCount = history.filter(
    (item) => item.responseStatus && item.responseStatus < 400
  ).length
  const avgTime =
    totalRequests > 0
      ? Math.round(
          history.reduce((sum, item) => sum + (item.responseTime ?? 0), 0) /
            totalRequests
        )
      : 0
  const successRate =
    totalRequests > 0
      ? ((successCount / totalRequests) * 100).toFixed(1)
      : "N/A"

  const recentSummary = history
    .slice(0, 5)
    .map(
      (item) =>
        `${item.method} ${item.endpoint || item.url} → ${item.responseStatus ?? "-"} (${item.responseTime ?? "-"}ms)`
    )
    .join("\n")

  return {
    pageLabel: "Dashboard",
    contextSummary: `${totalRequests} requêtes, ${successRate}% succès, ${avgTime}ms avg`,
    systemPrompt: `Tu es Monu IA, un assistant expert en APIs. L'utilisateur consulte son Dashboard.

Métriques actuelles :
- Total requêtes : ${totalRequests}
- Taux de succès : ${successRate}%
- Temps de réponse moyen : ${avgTime}ms

5 requêtes récentes :
${recentSummary || "Aucune requête enregistrée"}

Aide l'utilisateur à analyser ces métriques, identifier des problèmes de performance, et optimiser ses APIs. Réponds de façon concise et actionnable.`,
  }
}

function buildCollectionsContext(collections: Collection[]): AiPageContext {
  const totalCollections = collections.length
  const totalRequests = collections.reduce(
    (sum, col) => sum + col.requests.length,
    0
  )

  const collectionsSummary = collections
    .slice(0, 5)
    .map(
      (col) =>
        `• "${col.name}" — ${col.requests.length} requêtes (${col.requests
          .slice(0, 3)
          .map((r) => `${r.method} ${r.endpoint || r.url}`)
          .join(", ")}${col.requests.length > 3 ? "…" : ""})`
    )
    .join("\n")

  return {
    pageLabel: "Collections",
    contextSummary: `${totalCollections} collections, ${totalRequests} requêtes au total`,
    systemPrompt: `Tu es Monu IA, un assistant expert en APIs. L'utilisateur gère ses collections de requêtes.

Collections disponibles (${totalCollections}) :
${collectionsSummary || "Aucune collection"}

Aide l'utilisateur à organiser ses collections, vérifier la cohérence de ses requêtes, suggérer des optimisations d'organisation, ou expliquer les méthodes HTTP et les bonnes pratiques REST. Réponds de façon concise et actionnable.`,
  }
}

function buildApiEndpointsContext(history: HistoryItem[]): AiPageContext {
  const lastRequest = history[0]

  let lastRequestSummary = "Aucune requête récente"
  if (lastRequest) {
    lastRequestSummary = `${lastRequest.method} ${lastRequest.endpoint || lastRequest.url}
Statut : ${lastRequest.responseStatus ?? "-"}
Temps de réponse : ${lastRequest.responseTime ?? "-"}ms
Headers : ${JSON.stringify(lastRequest.headers ?? {})}
Body : ${lastRequest.body ?? "(vide)"}`
  }

  return {
    pageLabel: "API Endpoints",
    contextSummary: lastRequest
      ? `Dernière requête: ${lastRequest.method} ${lastRequest.endpoint || lastRequest.url}`
      : "Aucune requête récente",
    systemPrompt: `Tu es Monu IA, un assistant expert en APIs. L'utilisateur teste des endpoints API.

Dernière requête exécutée :
${lastRequestSummary}

Aide l'utilisateur à debugger ses requêtes, interpréter les codes de statut HTTP, corriger les headers, ou construire de meilleures requêtes. Réponds de façon concise et actionnable.`,
  }
}

function buildGenericContext(pageLabel: string): AiPageContext {
  return {
    pageLabel,
    contextSummary: "Assistant IA disponible",
    systemPrompt: `Tu es Monu IA, un assistant expert en APIs et développement web. L'utilisateur utilise Reqly, une plateforme de test et gestion d'APIs.

Aide l'utilisateur avec ses questions sur les APIs, HTTP, REST, ou l'outil en général. Réponds de façon concise et actionnable.`,
  }
}

export function useAiContext(): AiPageContext {
  const pathname = usePathname()
  const { history, collections } = useRequestStore()

  return useMemo(() => {
    if (pathname === "/dashboard") {
      return buildDashboardContext(history)
    }
    if (pathname === "/collections") {
      return buildCollectionsContext(collections)
    }
    if (pathname === "/" || pathname === "/api-endpoints") {
      return buildApiEndpointsContext(history)
    }
    if (pathname === "/ai-insights") {
      return buildGenericContext("AI Insights")
    }
    if (pathname === "/my-projects") {
      return buildGenericContext("Mes Projets")
    }
    if (pathname === "/settings") {
      return buildGenericContext("Paramètres")
    }
    if (pathname === "/documentation") {
      return buildGenericContext("Documentation")
    }
    return buildGenericContext("Reqly")
  }, [pathname, history, collections])
}
