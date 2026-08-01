"use client"

import type {
  HttpMethod,
  CollectionFolder,
  RequestItem,
  HistoryItem,
  Workspace,
  Collection,
  EnvironmentVariable,
  Environment,
  VariableMapping,
  Notification,
} from "@/lib/types"
import type { Dataset } from "./store/types"

export type {
  HttpMethod,
  CollectionFolder,
  RequestItem,
  HistoryItem,
  Workspace,
  Collection,
  EnvironmentVariable,
  Environment,
  VariableMapping,
  Notification,
} from "@/lib/types"
export type { Dataset } from "./store/types"

export interface RequestStore {
  history: HistoryItem[]
  collections: Collection[]
  environments: Environment[]
  notifications: Notification[]
  variableMappings: VariableMapping[]
  systemNotificationPermission?: string
  activeEnvironmentId: string | null
  projects: import("@/lib/types").SavedProject[]
  selectedProjectId: string | null
  currentRequest?: import("@/src/ai/engine").CurrentRequest | null
  lastResponse?: import("@/src/ai/engine").LastResponse | null
  environmentVariables?: Record<string, string>
  collectionHistory?: import("@/src/ai/engine").CurrentRequest[]
  activeCollection?: string | null
  aiAutoApply?: boolean
  aiAudit?: Array<{ id: string; actionType: string; detail?: any; result?: any; timestamp: number }>
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  datasets?: Dataset[]
}
