/**
 * Cloud engine — action vocabulary.
 *
 * Types partagés (AIContext, CurrentRequest, TestAssertion...), prompts et
 * helper de correction d'assertions. Le protocole JSON-actions legacy
 * (parseAIResponse + dispatchAIActions) a été retiré : l'agent utilise le
 * function calling natif via REQLY_TOOLS (lib/llm-tools.ts).
 */

export { ACTIONS_SYSTEM_PROMPT, PROMPTS } from "./prompts";
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
