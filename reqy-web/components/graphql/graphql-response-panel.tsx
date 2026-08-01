"use client"

import { useState } from "react"
import { ResponseViewer } from "./response-viewer"
import { SubscriptionViewer } from "./subscription-viewer"
import { GraphqlCodeGenerator } from "./graphql-code-generator"
import { GraphqlSchemaDiff } from "./graphql-schema-diff"
import { cn } from "@/lib/utils"
import type {
  GraphQLExecuteResult,
  GraphQLRequest,
  GraphqlSubscriptionMessage,
} from "@/lib/types"

interface Props {
  response?: GraphQLExecuteResult
  error?: string | null
  subscriptionMessages?: GraphqlSubscriptionMessage[]
  loading?: boolean
  onStop: () => void
  request: GraphQLRequest
  schema?: unknown
  endpoint?: string
  operationName?: string
}

type Tab = "response" | "code" | "diff"

export function GraphqlResponsePanel({
  response,
  error,
  subscriptionMessages,
  loading,
  onStop,
  request,
  schema,
  endpoint,
  operationName,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("response")
  const hasSubscription =
    subscriptionMessages !== undefined && subscriptionMessages.length > 0

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "response", label: "Response" },
    { id: "code", label: "Code" },
    { id: "diff", label: "Schema Diff" },
  ]

  return (
    <div
      className="flex flex-col h-full bg-card"
      data-testid="graphql-response-panel"
    >
      <div className="flex items-center gap-1 border-b px-3 py-1.5 bg-muted/20">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={cn(
              "px-2 py-0.5 text-xs rounded transition-colors",
              activeTab === t.id
                ? "bg-background text-foreground font-medium border border-border"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
            onClick={() => setActiveTab(t.id)}
            data-testid={`graphql-response-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === "response" &&
          (hasSubscription ? (
            <SubscriptionViewer
              messages={subscriptionMessages}
              onStop={onStop}
            />
          ) : (
            <ResponseViewer
              data={response?.data}
              errors={response?.errors}
              error={error ?? null}
              status={response?.statusCode}
              timeMs={response?.responseTimeMs}
              loading={loading}
            />
          ))}
        {activeTab === "code" && (
          <GraphqlCodeGenerator
            request={request}
            operationName={operationName ?? "Generated"}
          />
        )}
        {activeTab === "diff" && (
          <GraphqlSchemaDiff schema={schema ?? null} endpoint={endpoint} />
        )}
      </div>
    </div>
  )
}
