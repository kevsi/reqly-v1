/**
 * Reqly AI module — public barrel.
 *
 * Re-exports the action-vocabulary surface (prompts, parser, dispatch) now
 * hosted in `cloud-engine/actions` so both the app and the copilot tests
 * can import from a single stable path.
 */

export {
  parseAIResponse,
  dispatchAIActions,
  // Nom public stable : le JSON-actions (cloud-engine/actions) garde le nom
  // historique SYSTEM_PROMPT, distinct du persona ReqlyAI interne.
  ACTIONS_SYSTEM_PROMPT as SYSTEM_PROMPT,
  PROMPTS,
} from "@/src/ai/cloud-engine/actions";

export type {
  AIProvider,
  AIContext,
  AIAction,
  AIResponse,
  CurrentRequest,
  LastResponse,
  KeyValue,
  TestAssertion,
} from "@/src/ai/cloud-engine/actions";
