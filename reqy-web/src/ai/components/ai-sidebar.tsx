"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useCallback } from "react";
import {
  Sparkles,
  PanelRightClose,
  Clock,
  GripVerticalIcon,
  Play,
  FolderPlus,
  Import,
  ShieldCheck,
  RotateCcw,
  AlertTriangle,
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

  // Wire the new session handler so /new slash command creates a proper session.
  useEffect(() => {
    chat.setNewSessionHandler(history.handleNewSession);
  }, [chat, history.handleNewSession]);

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

  const sessionUsageLabel = formatTokens(chat.sessionUsage);

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
        data-testid="ai-sidebar"
        className={cn(
          "relative flex flex-col border-l border-border bg-background @container",
          "h-screen shrink-0 overflow-hidden",
          "transition-[width] duration-200 ease-out",
          isResizing && "transition-none",
          // Sur mobile, la sidebar doit être au-dessus de l'overlay (z-30)
          // et ne jamais dépasser la largeur de l'écran.
          "max-md:z-40 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:max-w-[calc(100vw-16px)]",
        )}
        style={{ width: open ? width : 0 }}
        inert={!open}
        aria-hidden={!open}
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
        <div className="flex items-center justify-between border-b border-border/60 px-4 h-14 shrink-0 min-w-0 bg-gradient-to-b from-card/80 to-transparent">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative">
              <div className="absolute -inset-1 rounded-xl bg-primary/20 blur-md" aria-hidden />
              <div className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
                <Sparkles className="size-4" />
              </div>
            </div>
            <div className="leading-tight truncate @max-[22rem]:hidden">
              <span className="block truncate text-sm font-semibold">Assistant IA</span>
              {isAiConfigured() ? (
                <Link
                  href="/settings#ai"
                  className="flex items-center gap-1 truncate text-[10px] text-muted-foreground/80 hover:text-primary transition-colors"
                >
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                  </span>
                  Connecté
                </Link>
              ) : (
                <Link
                  href="/settings#ai"
                  className="flex items-center gap-1 truncate text-[10px] text-warning/90 hover:text-warning transition-colors"
                >
                  <span className="size-1.5 rounded-full bg-warning" />À configurer →
                </Link>
              )}
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
        <div
          className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_4%,transparent),transparent_180px)]"
          ref={chat.messagesEndRef}
        >
          <div className="space-y-5 p-4">
            {chat.messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                <div className="relative">
                  <div
                    className="absolute -inset-3 rounded-full bg-primary/10 blur-2xl"
                    aria-hidden
                  />
                  <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-[0_8px_24px_-6px] shadow-primary/40 ring-1 ring-white/10">
                    <Sparkles className="size-8" />
                  </div>
                </div>
                <p className="mt-5 text-base font-semibold text-foreground">Assistant IA</p>
                <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground">
                  Demande-moi d'exécuter des requêtes, gérer des collections, ou naviguer dans
                  l'application.
                </p>
                <div className="mt-6 w-full max-w-[280px] space-y-2">
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
                      className="group/sugg flex w-full items-center justify-start gap-2.5 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2 text-xs text-muted-foreground shadow-sm transition-all hover:border-primary/30 hover:bg-card hover:text-foreground hover:shadow-md"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover/sugg:bg-primary/15">
                        <HintIcon className="size-3.5" />
                      </span>
                      {hint}
                    </Button>
                  ))}
                </div>
                <div className="mt-6 flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-[10px] text-muted-foreground/80">
                  <ShieldCheck className="size-3 text-success" />
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
                isLoading={chat.isLoading}
              />
            )}

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
                  title="Réessayer"
                >
                  <RotateCcw className="size-3" />
                </Button>
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
