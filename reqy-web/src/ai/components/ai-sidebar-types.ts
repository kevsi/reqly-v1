import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ContextAttachment, AgentUsage } from "@/src/ai/agent/types";

/** Fichier joint par l'utilisateur dans le composer (lecture texte côté client). */
export interface FileAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Contenu texte tronqué (injecté dans le prompt). */
  text?: string;
  /** Raison si le contenu n'a pas pu être extrait (affiché sur la chip). */
  unreadableReason?: "too_large" | "binary";
}

export type ArtifactKind = "html" | "code" | "markdown";

/** Artefact généré par l'assistant (code/HTML affichable en aperçu). */
export interface Artifact {
  id: string;
  /** Nom de fichier affiché, ex: landing-page-notes.html */
  title: string;
  kind: ArtifactKind;
  language?: string;
  content: string;
}

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
  /** Fichiers joints par l'utilisateur (affichage chips + injection prompt). */
  files?: FileAttachment[];
  /** Artefacts extraits de la réponse assistant (cartes + panneau aperçu). */
  artifacts?: Artifact[];
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
