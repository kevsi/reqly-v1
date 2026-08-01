import type { RequestStore } from "@/hooks/request-types"

export interface Dataset {
  id: string
  name: string
  format: "json" | "csv"
  rows: Record<string, string>[]
  workspaceId: string
  createdAt: number
  updatedAt: number
}

export type CommitFn = (updater: (prev: RequestStore) => RequestStore) => void
export const WORKSPACE_PERSONAL_ID = "ws-personal"
