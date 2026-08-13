import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ContextAttachment, AgentUsage } from "@/src/ai/agent/types";

/**
 * Phase transitoire d'un message assistant, pilotée par le hook de chat :
 * - `tool_calling`      : les tool calls sont en cours d'exécution ;
 * - `awaiting_response` : tool calls terminés, en attente du premier chunk
 *                         de texte (le provider peut streamer ou non) ;
 * - `streaming`         : les tokens de texte arrivent ;
 * - `done`              : réponse complète.
 *
 * Jamais persistée dans l'historique (état purement de rendu).
 */
export type ChatMessagePhase = "tool_calling" | "awaiting_response" | "streaming" | "done";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  steps?: ProcessStep[];
  attachments?: ContextAttachment[];
  commandName?: string;
  usage?: AgentUsage;
  /** Phase de rendu du message assistant (voir `ChatMessagePhase`). */
  phase?: ChatMessagePhase;
}

export interface ConversationSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  totalUsage?: AgentUsage;
  model?: string;
}
