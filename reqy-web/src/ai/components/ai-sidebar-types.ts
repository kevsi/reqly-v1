import type { AssistantStep, ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ContextAttachment, AgentUsage } from "@/src/ai/agent/types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  steps?: ProcessStep[];
  attachments?: ContextAttachment[];
  commandName?: string;
  usage?: AgentUsage;
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
