// Types MCP — socle commun depuis @reqly/shared (types canoniques).
// Le serveur MCP resserre les invariants de stockage (id, endpoint et timestamps
// toujours présents pour les requêtes/collections créées en mémoire) et ajoute
// ses propres types : historiques de runs et exports.

import type {
  HttpMethod,
  QueryParam,
  EnvironmentVariable,
  Environment,
  GraphQLConfig,
  Assertion,
  AssertionResult as SharedAssertionResult,
  RequestItem as SharedRequestItem,
  Collection as SharedCollection,
  CollectionFolder as SharedCollectionFolder,
} from "@reqly/shared";

export type {
  HttpMethod,
  QueryParam,
  EnvironmentVariable,
  Environment,
  GraphQLConfig,
  Assertion,
} from "@reqly/shared";

/** Résultat d'assertion MCP — l'assertion d'origine est toujours présente. */
export type AssertionResult = Omit<SharedAssertionResult, "assertion"> & { assertion: Assertion };

/** Requête stockée — les champs de gestion (id, endpoint, timestamps) sont obligatoires. */
export interface RequestItem extends SharedRequestItem {
  id: string;
  endpoint: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionFolder extends SharedCollectionFolder {
  id: string;
  parentId: string | null;
  collectionId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Collection extends Omit<SharedCollection, "id" | "requests" | "folders"> {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  workspaceId?: string;
  requests: RequestItem[];
  folders?: CollectionFolder[];
  createdAt: number;
  updatedAt: number;
}

export interface ExportBundle {
  version?: string;
  exportedAt?: string;
  collections: Collection[];
  environments: Environment[];
}

export interface RunResult {
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  size: number;
  passed: boolean;
  error?: string;
  body?: string;
  responseHeaders?: Record<string, string>;
  responseCookies?: Record<string, string>;
}

export interface RequestRunRecord {
  id: string;
  requestId: string;
  requestName: string;
  collectionId: string;
  collectionName: string;
  method: HttpMethod;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  size: number;
  passed: boolean;
  assertionResults?: AssertionResult[];
  error?: string;
  body?: string;
  executedAt: number;
}

export interface CollectionRunRecord {
  id: string;
  collectionId: string;
  collectionName: string;
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
  results: RequestRunRecord[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
  };
}

export interface RunnerOptions {
  envName?: string;
  timeoutMs: number;
  allowLocalHosts?: boolean;
  maxResponseSize?: number;
}
