"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useCallback } from "react";
import {
  Sparkles,
  PanelRightClose,
  Clock,
  Loader2,
  GripVerticalIcon,
  Play,
  FolderPlus,
  Import,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRequestStore } from "@/hooks/use-request-store";
import type { ConversationSession } from "@/src/ai/components/ai-sidebar-types";
import type { ContextAttachment } from "@/src/ai/agent/types";
import { AiHistoryPanel } from "@/src/ai/components/ai-history-panel";
import { AiChatMessage } from "@/src/ai/components/ai-chat-message";
import { AiChatInput } from "@/src/ai/components/ai-chat-input";
import { AiAgentControls } from "@/src/ai/components/ai-agent-controls";
import { AiPlanPanel } from "@/src/ai/components/ai-plan-panel";
import { AiRulesPanel } from "@/src/ai/components/ai-rules-panel";
import { AiPermissionsPopover } from "@/src/ai/components/ai-permissions-popover";
import { useAiSidebarWidth } from "@/src/ai/hooks/use-ai-sidebar-width";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";
import { useAiSidebarHistory } from "@/src/ai/hooks/use-ai-sidebar-history";
import { useAiAgentInput } from "@/src/ai/hooks/use-ai-agent-input";
import { createDefaultCommands, parseSlashCommand } from "@/src/ai/agent/commands";
import { formatTokens } from "@/src/ai/agent/usage";

// ── Component ──────────────────────────────────────────────────────────────

interface AiSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function AiSidebar({ open, onClose }: AiSidebarProps) {
  const { width, isResizing, sidebarRef, handleResizeStart } = useAiSidebarWidth();
  const chat = useAiSidebarChat();
  const history = useAiSidebarHistory(chat.messages, chat.modelUsed);
  const activeWorkspaceId = useRequestStore((s) => s.activeWorkspaceId) ?? "ws-personal";

  const inputState = useAiAgentInput(createDefaultCommands(), chat.runSlashCommand);

  // ── Focus input when sidebar opens ───────────────────────────────────────

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => chat.inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open, chat.inputRef]);

  // Fermeture au clavier (Escape) — le panneau est un dock custom sans Dialog Radix
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // ── Handlers combining chat + history + input ────────────────────────────

  const handleSelectSession = useCallback(
    (session: ConversationSession) => {
      history.handleLoadSessionMessages(session, chat.handleNewMessages);
      chat.setAttachments([]);
      inputState.clear();
    },
    [history, chat, inputState],
  );

  const handleNewSession = useCallback(() => {
    history.handleNewSession();
    chat.clearMessages();
    chat.setAttachments([]);
    inputState.clear();
  }, [history, chat, inputState]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      if (id === history.currentSessionId) {
        chat.clearMessages();
        chat.setAttachments([]);
        inputState.clear();
      }
      history.handleDeleteSession(id);
    },
    [history, chat, inputState],
  );

  const handleSend = () => {
    const text = inputState.value.trim();
    if (!text || chat.isLoading) return;
    const parsed = parseSlashCommand(text);
    if (parsed) {
      chat.runSlashCommand(parsed.name, parsed.args);
    } else {
      void chat.sendMessage(text);
    }
    inputState.clear();
  };

  const handleSelectMention = (a: ContextAttachment) => {
    chat.attachContext(a);
    inputState.acceptMention(a);
  };

  const handleRemoveAttachment = (id: string) => {
    chat.setAttachments(chat.attachments.filter((x) => x.id !== id));
  };

  const sessionUsageLabel = formatTokens(chat.sessionUsage);

  const hasLiveSteps = chat.messages.some(
    (m) =>
      m.role === "assistant" &&
      (m.steps ?? []).some(
        (s) =>
          s.status === "in_progress" ||
          s.status === "pending" ||
          s.status === "awaiting_confirmation",
      ),
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
          onClick={onClose}
          aria-label="Fermer le panneau de l'assistant"
        />
      )}

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        role="complementary"
        aria-label="Assistant IA"
        className={cn(
          "relative flex flex-col border-l border-border bg-background @container",
          "h-screen shrink-0 overflow-hidden",
          "transition-[width] duration-200 ease-out",
          isResizing && "transition-none",
          // Sur mobile, la sidebar IA ne doit jamais dépasser la largeur de l'écran
          "max-md:max-w-[calc(100vw-16px)]",
        )}
        style={{ width: open ? width : 0 }}
      >
        {/* Resize handle */}
        {open && (
          <div
            className={cn(
              "absolute left-0 inset-y-0 z-20",
              "bg-border w-px transition-colors duration-150",
              "hover:bg-primary/40",
              isResizing && "bg-primary/60",
              "cursor-col-resize select-none",
              "flex items-center justify-center",
              "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
            )}
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
          >
            <div
              className={cn(
                "flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-border",
                "opacity-0 hover:opacity-100 transition-opacity duration-150",
                isResizing && "opacity-100",
              )}
            >
              <GripVerticalIcon className="size-2.5" />
            </div>
          </div>
        )}
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border px-4 h-12 shrink-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Sparkles className="size-4" />
            </div>
            <div className="leading-tight truncate @max-[22rem]:hidden">
              <span className="block truncate text-sm font-semibold">Assistant IA</span>
              <span className="block truncate text-[10px] text-muted-foreground/70 @max-[30rem]:hidden">
                Reqly Copilot
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <AiAgentControls
              mode={chat.agentMode}
              onModeChange={chat.setAgentMode}
              autoApply={chat.autoApply}
              onAutoApplyChange={chat.setAutoApply}
              onOpenRules={() => chat.setRulesPanelOpen(true)}
              onOpenPermissions={() => chat.setPermissionsPanelOpen(true)}
            />
            {sessionUsageLabel && (
              <span className="text-[10px] text-muted-foreground/60 px-1 @max-[30rem]:hidden">
                {sessionUsageLabel}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => history.setHistoryOpen(!history.historyOpen)}
              className={cn(
                "size-7 [&_svg]:size-3.5",
                history.historyOpen
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
              title="Historique des conversations"
            >
              <Clock className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="size-7 [&_svg]:size-4 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Fermer"
            >
              <PanelRightClose className="size-4" />
            </Button>
          </div>
        </div>

        {chat.rulesPanelOpen && (
          <AiRulesPanel
            workspaceId={activeWorkspaceId}
            onClose={() => chat.setRulesPanelOpen(false)}
          />
        )}

        {chat.permissionsPanelOpen && <AiPermissionsPopover />}

        {history.historyOpen && (
          <AiHistoryPanel
            sessions={history.sessions}
            currentSessionId={history.currentSessionId}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onNewSession={handleNewSession}
          />
        )}

        {/* ── Messages ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" ref={chat.messagesEndRef}>
          <div className="p-4 space-y-4">
            {chat.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/20 shadow-sm">
                  <Sparkles className="size-7" />
                </div>
                <p className="mt-4 text-sm font-semibold text-foreground">Assistant IA</p>
                <p className="mt-1 max-w-[240px] text-xs">
                  Demande-moi d'exécuter des requêtes, gérer des collections, ou naviguer dans
                  l'application.
                </p>
                <div className="mt-5 w-full max-w-[260px] space-y-1.5">
                  {[
                    { icon: Play, hint: "Exécute GET /api/users" },
                    { icon: FolderPlus, hint: "Crée une collection 'Tests API'" },
                    { icon: Import, hint: "Importe le projet depuis GitHub" },
                  ].map(({ icon: HintIcon, hint }) => (
                    <Button
                      key={hint}
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        inputState.setValue(hint);
                        chat.inputRef.current?.focus();
                      }}
                      className="group/sugg flex w-full items-center justify-start gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <HintIcon className="size-3.5 shrink-0 text-primary/70 transition-colors group-hover/sugg:text-primary" />
                      {hint}
                    </Button>
                  ))}
                </div>
                <div className="mt-6 flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground/70">
                  <ShieldCheck className="size-3 text-success/80" />
                  L&apos;IA n&apos;agit que sur demande explicite
                </div>
              </div>
            )}

            {chat.messages.map((msg, i) => (
              <AiChatMessage
                key={i}
                message={msg}
                index={i}
                editingIndex={chat.editingIndex}
                editingText={chat.editingText}
                copiedIndex={chat.copiedIndex}
                onEditStart={chat.handleEditStart}
                onCopy={chat.handleCopy}
                onRetry={chat.handleRetry}
                onEditCancel={chat.handleEditCancel}
                onEditConfirm={chat.handleEditConfirm}
                onEditingTextChange={chat.setEditingText}
                onConfirm={(_stepId, confirmed) => chat.confirmAction(confirmed)}
              />
            ))}

            {chat.pendingPlan && (
              <AiPlanPanel
                planText={chat.pendingPlan.planText}
                toolCalls={chat.pendingPlan.toolCalls}
                onApprove={chat.approvePlan}
                onReject={chat.rejectPlan}
              />
            )}

            {chat.isLoading && !hasLiveSteps && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground mr-6">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                Réflexion
                <span className="flex items-center gap-0.5">
                  <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:0ms]" />
                  <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:150ms]" />
                  <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            )}

            {chat.error && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive mr-6">
                {chat.error}
              </div>
            )}
          </div>
        </div>

        <AiChatInput
          value={inputState.value}
          onValueChange={inputState.handleChange}
          onSend={handleSend}
          onStop={chat.stopStreaming}
          isLoading={chat.isLoading}
          inputRef={chat.inputRef}
          attachments={chat.attachments}
          onRemoveAttachment={handleRemoveAttachment}
          commandResults={inputState.commandResults}
          mentionResults={inputState.mentionResults}
          onSelectCommand={inputState.acceptCommand}
          onSelectMention={handleSelectMention}
        />
      </div>
    </>
  );
}
