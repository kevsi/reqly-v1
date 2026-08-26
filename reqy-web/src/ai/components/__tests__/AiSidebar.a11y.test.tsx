import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiSidebar } from "@/src/ai/components/ai-sidebar";

const mockChat = {
  messages: [],
  isLoading: false,
  error: null,
  editingIndex: null,
  editingText: "",
  copiedIndex: null,
  agentMode: "act" as const,
  autoApply: false,
  pendingPlan: null,
  attachments: [],
  sessionUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
  modelUsed: null,
  rulesPanelOpen: false,
  permissionsPanelOpen: false,
  abortRef: { current: null },
  inputRef: { current: null },
  messagesEndRef: { current: null },
  setAgentMode: vi.fn(),
  setAutoApply: vi.fn(),
  setPendingPlan: vi.fn(),
  approvePlan: vi.fn(),
  rejectPlan: vi.fn(),
  setAttachments: vi.fn(),
  attachContext: vi.fn(),
  stopStreaming: vi.fn(),
  confirmAction: vi.fn(),
  runSlashCommand: vi.fn(),
  setRulesPanelOpen: vi.fn(),
  setPermissionsPanelOpen: vi.fn(),
  setNewSessionHandler: vi.fn(),
  setError: vi.fn(),
  setIsLoading: vi.fn(),
  setEditingText: vi.fn(),
  handleEditStart: vi.fn(),
  handleEditCancel: vi.fn(),
  handleEditConfirm: vi.fn(),
  handleRetry: vi.fn(),
  handleCopy: vi.fn(),
  handleNewMessages: vi.fn(),
  clearMessages: vi.fn(),
  sendMessage: vi.fn(),
};

const mockHistory = {
  sessions: [],
  currentSessionId: null,
  historyOpen: false,
  setHistoryOpen: vi.fn(),
  handleNewSession: vi.fn(),
  handleSelectSession: vi.fn(),
  handleLoadSessionMessages: vi.fn(),
  handleDeleteSession: vi.fn(),
};

const mockInputState = {
  value: "",
  handleChange: vi.fn(),
  acceptCommand: vi.fn(),
  acceptMention: vi.fn(),
  clear: vi.fn(),
  commandQuery: null,
  mentionQuery: null,
  commandResults: [],
  handleSelectMention: vi.fn(),
  handleRemoveAttachment: vi.fn(),
};

vi.mock("@/src/ai/hooks/use-ai-sidebar-chat", () => ({
  useAiSidebarChat: () => mockChat,
}));

vi.mock("@/src/ai/hooks/use-ai-sidebar-history", () => ({
  useAiSidebarHistory: () => mockHistory,
}));

vi.mock("@/src/ai/hooks/use-ai-sidebar-width", () => ({
  useAiSidebarWidth: () => ({
    width: 400,
    isResizing: false,
    sidebarRef: { current: null },
    handleResizeStart: vi.fn(),
  }),
}));

vi.mock("@/src/ai/hooks/use-ai-agent-input", () => ({
  useAiAgentInput: () => mockInputState,
}));

vi.mock("@/hooks/use-request-store", () => ({
  useRequestStore: () => ({
    activeWorkspaceId: "ws-personal",
    currentRequest: null,
    lastResponse: null,
  }),
}));

vi.mock("@/src/ai/components/ai-history-panel", () => ({
  AiHistoryPanel: () => <div data-testid="history-panel" />,
}));

vi.mock("@/src/ai/components/ai-chat-message", () => ({
  AiChatMessage: () => <div data-testid="chat-message" />,
}));

vi.mock("@/src/ai/components/ai-chat-input", () => ({
  AiChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock("@/src/ai/components/ai-agent-controls", () => ({
  AiAgentControls: () => <div data-testid="agent-controls" />,
}));

vi.mock("@/src/ai/components/ai-plan-panel", () => ({
  AiPlanPanel: () => <div data-testid="plan-panel" />,
}));

vi.mock("@/src/ai/components/ai-rules-panel", () => ({
  AiRulesPanel: () => <div data-testid="rules-panel" />,
}));

vi.mock("@/src/ai/components/ai-permissions-popover", () => ({
  AiPermissionsPopover: () => <div data-testid="permissions-popover" />,
}));

vi.mock("@/lib/ai-config", () => ({
  isAiConfigured: () => true,
  DEFAULT_MODELS: { openai: "gpt-4o" },
}));

describe("AiSidebar — bug #6 (focusable controls when closed)", () => {
  it("A: sidebar is inert when closed so no control leaks into tab order", () => {
    render(<AiSidebar open={false} onClose={() => {}} />);
    const sidebar = screen.getByTestId("ai-sidebar");
    expect(sidebar.hasAttribute("inert")).toBe(true);
  });
});
