"use client";

import type {
  HistoryItem,
  Workspace,
  Collection,
  Environment,
  VariableMapping,
  Notification,
} from "@/lib/types";
import type { Dataset } from "./store/types";

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
} from "@/lib/types";
export type { Dataset } from "./store/types";

import type { Language } from "@/src/i18n";

export interface RequestStore {
  /** Quick-start premier lancement vu/terminé. */
  onboardingCompleted?: boolean;
  language: Language;
  history: HistoryItem[];
  collections: Collection[];
  environments: Environment[];
  notifications: Notification[];
  variableMappings: VariableMapping[];
  systemNotificationPermission?: string;
  activeEnvironmentId: string | null;
  projects: import("@/lib/types").SavedProject[];
  selectedProjectId: string | null;
  currentRequest?: import("@/src/ai/cloud-engine/actions").CurrentRequest | null;
  lastResponse?: import("@/src/ai/cloud-engine/actions").LastResponse | null;
  environmentVariables?: Record<string, string>;
  collectionHistory?: import("@/src/ai/cloud-engine/actions").CurrentRequest[];
  activeCollection?: string | null;
  aiAutoApply?: boolean;
  aiAudit?: Array<{
    id: string;
    actionType: string;
    detail?: unknown;
    result?: unknown;
    timestamp: number;
  }>;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  datasets?: Dataset[];
}
