/**
 * AI engine — barrel export.
 *
 * Public API (preserved from the original monolithic ai-engine.ts):
 *   - Types: AIProvider, AIContext, AIAction, AIResponse, ...
 *   - Prompts: SYSTEM_PROMPT, PROMPTS
 *   - callAI, callAIText, parseAIResponse
 *   - dispatchAIActions
 *
 * Internal split:
 *   - types.ts      — type definitions
 *   - prompts.ts    — SYSTEM_PROMPT + prompt templates
 *   - parser.ts     — parseAIResponse, isValidAIResponse
 *   - providers.ts      — callAI, callAIText
 *   - providers-utils.ts — fetchWithTimeout, extractProxyError, getProviderGroup (internal)
 *   - dispatch.ts   — dispatchAIActions
 */

export * from "./types";
export { SYSTEM_PROMPT, PROMPTS } from "./prompts";
export { parseAIResponse, isValidAIResponse } from "./parser";
export { callAI, callAIText } from "./providers";
export { dispatchAIActions } from "./dispatch";
