"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  PanelRightClose,
  Clock,
  GripVerticalIcon,
  Play,
  FolderPlus,
  Import,
  Key,
  ShieldCheck,
  RotateCcw,
  AlertTriangle,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRequestStore } from "@/hooks/use-request-store";
import { isAiConfigured } from "@/lib/ai-config";
import type { ConversationSession } from "@/src/ai/components/ai-sidebar-types";
import type { ContextAttachment } from "@/src/ai/agent/types";
import { AiHistoryPanel } from "@/src/ai/components/ai-history-panel";
import { AiChatMessage } from "@/src/ai/components/ai-chat-message";
import { AiChatInput } from "@/src/ai/components/ai-chat-input";
import { AiCodeExecutionCard } from "@/src/ai/components/ai-code-execution-card";
import { AiAgentControls } from "@/src/ai/components/ai-agent-controls";
import { AiPlanPanel } from "@/src/ai/components/ai-plan-panel";
import { AiRulesPanel } from "@/src/ai/components/ai-rules-panel";
import { AiPermissionsPopover } from "@/src/ai/components/ai-permissions-popover";
import { useAiSidebarWidth } from "@/src/ai/hooks/use-ai-sidebar-width";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";
import { useAiSidebarHistory } from "@/src/ai/hooks/use-ai-sidebar-history";
import { useAiAgentInput } from "@/src/ai/hooks/use-ai-agent-input";
import { createDefaultCommands, parseSlashCommand } from "@/src/ai/agent/commands";

// ── Component ──────────────────────────────────────────────────────────────

interface AiSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function AiSidebar({ open, onClose }: AiSidebarProps) {
  const { t } = useTranslation();
  const { width, isResizing, sidebarRef, handleResizeStart } = useAiSidebarWidth();
  const chat = useAiSidebarChat();
  const history = useAiSidebarHistory(chat.messages, chat.modelUsed);
  const activeWorkspaceId = useRequestStore((s) => s.activeWorkspaceId) ?? "ws-personal";
  const inputState = useAiAgentInput(createDefaultCommands(), chat.runSlashCommand);

  // Wire /new slash command to proper session handler
  useEffect(() => {
    chat.setNewSessionHandler(history.handleNewSession);
  }, [chat, history.handleNewSession]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => chat.inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open, chat.inputRef]);

  // Escape closes the sidebar (no Radix Dialog — custom dock)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectSession = useCallback(
    (session: ConversationSession) => {
      history.handleLoadSessionMessages(session, chat.handleNewMessages);
      chat.setAttachments([]);
      chat.setPendingPlan?.(null);
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
          onClick={onClose}
          aria-label={t("ai.sidebar.closePanelAria")}
        />
      )}

      {/* Sidebar panel */}
      <div
        ref={sidebarRef}
        id="reqly-ai-sidebar"
        role="complementary"
        aria-label={t("ai.sidebar.title")}
        data-testid="ai-sidebar"
        className={cn(
          "relative flex flex-col border-l border-border bg-background @container",
          "h-screen shrink-0 overflow-hidden",
          "transition-[width] duration-200 ease-out",
          isResizing && "transition-none",
          "max-md:z-40 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:max-w-[calc(100vw-16px)]",
        )}
        style={{ width: open ? width : 0 }}
        inert={!open}
        aria-hidden={!open}
      >
        {/* Ambient top accent */}
        <span className="ambient-bar z-20" aria-hidden />
        {/* ── Resize handle ─────────────────────────────────────── */}
        {open && (
          <div
            className={cn(
              "absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize select-none",
              "-ml-0.5 flex items-center justify-center bg-transparent",
            )}
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
          >
            <div
              className={cn(
                "flex h-8 w-1.5 items-center justify-center rounded-full border border-border/40 bg-border/40 transition-all duration-200",
                "opacity-0 hover:opacity-100 hover:w-2 hover:bg-primary/40",
                isResizing && "opacity-100 w-2 bg-primary/50",
              )}
            >
              <GripVerticalIcon className="size-2 text-muted-foreground/70" />
            </div>
          </div>
        )}

        {/* ── Header — identity + actions ─────────────────────── */}
        <div className="relative flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-3 backdrop-blur-sm">
          {/* Identity */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative flex size-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-[0_2px_10px_-2px] shadow-primary/50">
              <Sparkles className="size-3.5" />
              <span
                className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20 dark:ring-black/10"
                aria-hidden
              />
            </div>
            <div className="min-w-0 leading-tight @max-[22rem]:hidden">
              <span className="block truncate text-sm font-semibold tracking-tight">
                {t("ai.sidebar.title")}
              </span>
              {isAiConfigured() ? (
                <Link
                  href="/settings#ai"
                  className="flex items-center gap-1 truncate text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px] shadow-success/70" />
                  {t("ai.sidebar.connected")}
                </Link>
              ) : (
                <Link
                  href="/settings#ai"
                  className="flex items-center gap-1 truncate text-[10px] text-warning/90 transition-colors hover:text-warning"
                >
                  <span className="size-1.5 rounded-full bg-warning shadow-[0_0_6px] shadow-warning/70" />
                  {t("ai.sidebar.toConfigure")}
                </Link>
              )}
            </div>
          </div>

          {/* Right actions: new conversation + history + close */}
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleNewSession}
              className="size-7 rounded-lg [&_svg]:size-3.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
              title={t("ai.sidebar.newConversation")}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => history.setHistoryOpen(!history.historyOpen)}
              className={cn(
                "size-7 rounded-lg [&_svg]:size-3.5 transition-all",
                history.historyOpen
                  ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              title={t("ai.sidebar.history")}
            >
              <Clock className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="size-7 rounded-lg [&_svg]:size-4 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
              title={t("ai.sidebar.closeEsc")}
            >
              <PanelRightClose className="size-4" />
            </Button>
          </div>
        </div>

        {/* ── Mode bar ─────────────────────────────────────────────── */}
        <AiAgentControls
          mode={chat.agentMode}
          onModeChange={chat.setAgentMode}
          autoApply={chat.autoApply}
          onAutoApplyChange={chat.setAutoApply}
          onOpenRules={() => chat.setRulesPanelOpen(true)}
          onOpenPermissions={() => chat.setPermissionsPanelOpen(true)}
          sessionUsage={chat.sessionUsage}
        />

        {/* ── Content area (relative — panels overlay here) ─────── */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* Rules panel — full overlay */}
          {chat.rulesPanelOpen && (
            <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background">
              <AiRulesPanel
                workspaceId={activeWorkspaceId}
                onClose={() => chat.setRulesPanelOpen(false)}
              />
            </div>
          )}

          {/* Permissions panel — full overlay */}
          {chat.permissionsPanelOpen && (
            <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background">
              <AiPermissionsPopover onClose={() => chat.setPermissionsPanelOpen(false)} />
            </div>
          )}

          {/* History panel — full-height slide-in */}
          {history.historyOpen && (
            <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background animate-in slide-in-from-top-2 duration-150">
              <div className="flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-sm">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="size-3.5 text-primary" />
                  Conversations
                </span>
                <button
                  type="button"
                  onClick={() => history.setHistoryOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Fermer
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <AiHistoryPanel
                  sessions={history.sessions}
                  currentSessionId={history.currentSessionId}
                  onSelectSession={handleSelectSession}
                  onDeleteSession={handleDeleteSession}
                  onNewSession={handleNewSession}
                />
              </div>
            </div>
          )}

          {/* ── Messages ──────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto" ref={chat.messagesEndRef}>
            <div className="space-y-5 p-4">
              {/* Empty state */}
              {chat.messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                  <div className="relative">
                    <div className="flex size-14 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-[0_8px_24px_-6px] shadow-primary/40">
                      <Sparkles className="size-6" />
                      <span
                        className="absolute inset-0 rounded-[1.25rem] ring-1 ring-inset ring-white/25 dark:ring-black/10"
                        aria-hidden
                      />
                    </div>
                    <span
                      className="absolute -right-1.5 -top-1 size-3 rounded-full bg-success ring-2 ring-background shadow-[0_0_10px] shadow-success/70"
                      aria-hidden
                    />
                  </div>
                  <p className="mt-5 text-sm font-semibold text-foreground">
                    {t("ai.sidebar.readyToHelp")}
                  </p>
                  <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-muted-foreground">
                    {t("ai.sidebar.readyToHelpDesc")}
                  </p>

                  <div className="mt-6 w-full max-w-[272px] space-y-1.5">
                    {[
                      { icon: Play, hintKey: "ai.sidebar.suggestion1" },
                      { icon: FolderPlus, hintKey: "ai.sidebar.suggestion2" },
                      { icon: Import, hintKey: "ai.sidebar.suggestion3" },
                    ].map(({ icon: HintIcon, hintKey }) => {
                      const hint = t(hintKey);
                      return (
                        <button
                          key={hint}
                          type="button"
                          onClick={() => {
                            inputState.setValue(hint);
                            chat.inputRef.current?.focus();
                          }}
                          className="group/sugg flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 text-left text-xs text-muted-foreground shadow-xs transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-card hover:text-foreground hover:shadow-md"
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover/sugg:bg-primary/15">
                            <HintIcon className="size-3" />
                          </span>
                          <span className="flex-1">{hint}</span>
                          <span
                            className="text-[10px] text-muted-foreground/0 transition-colors group-hover/sugg:text-primary/70"
                            aria-hidden
                          >
                            ↗
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-6 flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-[10px] text-muted-foreground">
                    <ShieldCheck className="size-3 text-success" />
                    {t("ai.sidebar.consentNote")}
                  </div>
                </div>
              )}

              {/* Chat messages */}
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
                  onTypingUpdate={chat.scrollToBottom}
                  onExecuteRequest={chat.requestCodeExecution}
                />
              ))}

              {/* Pending plan */}
              {chat.pendingPlan && (
                <AiPlanPanel
                  planText={chat.pendingPlan.planText}
                  toolCalls={chat.pendingPlan.toolCalls}
                  onApprove={chat.approvePlan}
                  onReject={chat.rejectPlan}
                  isLoading={chat.isLoading}
                />
              )}

              {/* Error banner */}
              {chat.error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive mr-6">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span className="flex-1">{chat.error}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={chat.handleRetry}
                    className="size-6 shrink-0 [&_svg]:size-3 text-destructive hover:text-destructive/80"
                    title={t("ai.sidebar.retry")}
                  >
                    <RotateCcw className="size-3" />
                  </Button>
                </div>
              )}

              {/* Missing AI config — guided setup CTA (R19) */}
              {chat.missingConfig && (
                <div
                  className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning mr-6"
                  data-testid="ai-sidebar-missing-config"
                >
                  <Key className="size-4 shrink-0" />
                  <span className="flex-1">
                    {t("ai.sidebar.configBannerTitle", {
                      defaultValue: "Aucune clé IA configurée pour cet espace.",
                    })}
                  </span>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-7 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                  >
                    <Link href="/settings#ai" data-testid="ai-sidebar-config-cta">
                      {t("ai.sidebar.configCta", { defaultValue: "Configurer l'accès IA" })}
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </div>

          {chat.pendingCodeRequest && (
            <AiCodeExecutionCard
              request={chat.pendingCodeRequest}
              isExecuting={chat.isExecutingCode}
              onConfirm={() => void chat.confirmCodeExecution()}
              onCancel={chat.cancelCodeExecution}
            />
          )}

          {/* ── Input ─────────────────────────────────────────────── */}
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
      </div>
    </>
  );
}
