export type ContextAttachmentType =
  | "collection"
  | "request"
  | "environment"
  | "response"
  | "doc";

export interface ContextAttachment {
  id: string;        // "collection:<id>" | "request:<id>" | ...
  type: ContextAttachmentType;
  refId: string;     // id de l'entité sous-jacente
  label: string;
  detail?: string;
}

export type ToolPermission = "allow" | "deny" | "ask";

export type AgentMode = "plan" | "act";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}
