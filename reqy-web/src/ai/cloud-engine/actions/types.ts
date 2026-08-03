/**
 * Cloud engine — action vocabulary types (migré depuis le moteur legacy
 * `src/ai/engine/types.ts`).
 *
 * Types partagés du flux « actions » REST : contexte de requête, réponse,
 * assertions et le vocabulaire d'actions que les modèles peuvent produire.
 */

import type { HttpMethod } from "@/lib/types";
import type { AIProvider as AIProviderType } from "@/lib/types";
import type { TauriCookie } from "@/lib/tauri";

export type { HttpMethod as HTTPMethod };

export type KeyValue = Record<string, string>;

export type CurrentRequest = {
  method: HttpMethod;
  url: string;
  headers: KeyValue;
  params: KeyValue;
  body?: unknown;
  auth?: unknown;
  aiAssertions?: TestAssertion[];
  documentation?: string;
};

export type AIProvider = AIProviderType;

export type LastResponse = {
  status: number;
  statusText?: string;
  durationMs?: number;
  headers: KeyValue;
  body?: unknown;
  cookies?: TauriCookie[];
};

export type AIContext = {
  currentRequest: CurrentRequest;
  lastResponse?: LastResponse | null;
  environmentVariables: Record<string, string>;
  collectionHistory: CurrentRequest[];
  activeCollection?: string | null;
};

export type TestAssertion = {
  label: string;
  code: string;
};

/* AI Action payload definitions */

export type FillRequestAction = {
  type: "FILL_REQUEST";
  payload: Partial<CurrentRequest> & { reason?: string; run?: boolean };
};

export type AddAssertionsAction = {
  type: "ADD_ASSERTIONS";
  payload: { assertions: TestAssertion[]; autoApply?: boolean };
};

export type CreateVariableAction = {
  type: "CREATE_VARIABLE";
  payload: { name: string; value?: string; fromResponsePath?: string; description?: string };
};

export type SuggestFixAction = {
  type: "SUGGEST_FIX";
  payload: { description: string; patch?: Partial<CurrentRequest>; autoApply?: boolean };
};

export type GenerateDocAction = {
  type: "GENERATE_DOC";
  payload: { markdown: string; title?: string };
};

export type ExplainAction = {
  type: "EXPLAIN";
  payload: { message: string };
};

export type ExecuteRequestAction = {
  type: "EXECUTE_REQUEST";
  payload: Partial<CurrentRequest> & { reason?: string };
};

export type RunBatchAction = {
  type: "RUN_BATCH";
  payload: { requests: Array<Partial<CurrentRequest>> };
};

export type AIAction =
  | FillRequestAction
  | AddAssertionsAction
  | CreateVariableAction
  | SuggestFixAction
  | GenerateDocAction
  | ExplainAction
  | ExecuteRequestAction
  | RunBatchAction;

export type AIResponse = {
  actions: AIAction[];
  summary: string;
};

export interface RetrievedChunk {
  source: string;
  content: string;
  score?: number;
  origin?: string;
}
