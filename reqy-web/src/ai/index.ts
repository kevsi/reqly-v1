/**
 * Reqly AI module — public barrel.
 *
 * Re-exports the runtime surface from `lib/ai-engine` so both the app
 * and the copilot tests can import from a single stable path.
 */

export {
  callAI,
  callAIText,
  parseAIResponse,
  dispatchAIActions,
  SYSTEM_PROMPT,
  PROMPTS,
} from "@/src/ai/engine";

export type {
  AIProvider,
  AIContext,
  AIAction,
  AIResponse,
  CurrentRequest,
  LastResponse,
  KeyValue,
  TestAssertion,
} from "@/src/ai/engine";
