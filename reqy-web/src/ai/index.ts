/**
 * Reqly AI module — public barrel.
 *
 * Types partagés + prompts du cloud-engine. Le protocole JSON-actions legacy
 * (parseAIResponse/dispatchAIActions) a été retiré — l'agent utilise le
 * function calling natif (REQLY_TOOLS).
 */

export { ACTIONS_SYSTEM_PROMPT, PROMPTS } from "@/src/ai/cloud-engine/actions";

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
