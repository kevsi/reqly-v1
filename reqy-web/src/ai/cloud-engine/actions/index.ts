/**
 * Cloud engine — action vocabulary (fusion du moteur legacy `src/ai/engine`).
 *
 * Public API du flux « actions » REST :
 *   - Types : AIContext, AIAction, AIResponse, CurrentRequest, LastResponse,
 *     TestAssertion, KeyValue, HTTPMethod, ...
 *   - Prompts : ACTIONS_SYSTEM_PROMPT (JSON-actions) + PROMPTS.*
 *   - parseAIResponse, isValidAIResponse
 *   - dispatchAIActions (gate allowAutoApply)
 *   - proposeAssertionCorrection (read-only, aucun dispatch mutateur)
 */

export { ACTIONS_SYSTEM_PROMPT, PROMPTS } from "./prompts";
export { parseAIResponse, isValidAIResponse } from "./parser";
export { dispatchAIActions } from "./dispatch";
export type {
  KeyValue,
  CurrentRequest,
  AIProvider,
  LastResponse,
  AIContext,
  TestAssertion,
  FillRequestAction,
  AddAssertionsAction,
  CreateVariableAction,
  SuggestFixAction,
  GenerateDocAction,
  ExplainAction,
  ExecuteRequestAction,
  RunBatchAction,
  AIAction,
  AIResponse,
  RetrievedChunk,
  HTTPMethod,
} from "./types";
