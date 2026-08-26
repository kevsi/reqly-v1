"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useCallback, useState } from "react";
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
  Copy,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRequestStore } from "@/hooks/use-request-store";
import { isAiConfigured } from "@/lib/ai-config";
import type { ConversationSession, Artifact } from "@/src/ai/components/ai-sidebar-types";
import type { ContextAttachment } from "@/src/ai/agent/types";
import { AiArtifactPanel } from "@/src/ai/components/ai-artifacts";
import { AiHistoryPanel } from "@/src/ai/components/ai-history-panel";
import { AiChatMessage } from "@/src/ai/components/ai-chat-message";
import { AiChatInput } from "@/src/ai/components/ai-chat-input";
import { AiCodeExecutionCard } from "@/src/ai/components/ai-code-execution-card";
import { AiAgentControls } from "@/src/ai/components/ai-agent-controls";
import { AiPlanPanel } from "@/src/ai/components/ai-plan-panel";
import { AiRulesPanel } from "@/src/ai/components/ai-rules-panel";
import { AiPermissionsPopover } from "@/src/ai/components/ai-permissions-popover";
import { AiModelPicker } from "@/src/ai/components/ai-model-picker";
import { FocusScope } from "@/src/ai/components/focus-scope";
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
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const configured = isAiConfigured();

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

  // H4 — Escape ferme l'overlay le plus haut d'abord (artefact, permissions,
  // règles, historique) ; la sidebar ne se ferme qu'une fois tout refermé.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeArtifact) {
        setActiveArtifact(null);
        e.preventDefault();
        return;
      }
      if (chat.permissionsPanelOpen) {
        chat.setPermissionsPanelOpen(false);
        e.preventDefault();
        return;
      }
      if (chat.rulesPanelOpen) {
        chat.setRulesPanelOpen(false);
        e.preventDefault();
        return;
      }
      if (history.historyOpen) {
        history.setHistoryOpen(false);
        e.preventDefault();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, activeArtifact, chat, history]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectSession = useCallback(
    (session: ConversationSession) => {
      history.handleLoadSessionMessages(session, chat.handleNewMessages);
      chat.setAttachments([]);
      chat.setPendingPlan?.(null);
      inputState.clear();
      // Atterrir sur le dernier message de la conversation chargée.
      chat.forceScrollToBottom();
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
          dragActive && "ring-2 ring-inset ring-primary/50",
        )}
        style={{ width: open ? width : 0 }}
        inert={!open}
        aria-hidden={!open}
        onDragOver={(e) => {
          if (!open) return;
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          // P3.9 — glisser-déposer des fichiers n'importe où dans la sidebar.
          if (e.dataTransfer.files?.length) void chat.attachFiles(e.dataTransfer.files);
        }}
      >
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
            <div className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-3.5" />
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
                  <span className="size-1.5 rounded-full bg-success" />
                  {t("ai.sidebar.connected")}
                </Link>
              ) : (
                <Link
                  href="/settings#ai"
                  className="flex items-center gap-1 truncate text-[10px] text-warning/90 transition-colors hover:text-warning"
                >
                  <span className="size-1.5 rounded-full bg-warning" />
                  {t("ai.sidebar.toConfigure")}
                </Link>
              )}
            </div>
          </div>

          {/* Right actions: model picker + new conversation + history + close */}
          <div className="flex shrink-0 items-center gap-1.5">
            <AiModelPicker />
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
          model={chat.modelUsed}
          batchConfirm={chat.batchConfirm}
          onBatchConfirmChange={chat.setBatchConfirm}
        />

        {/* ── Content area (relative — panels overlay here) ─────── */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* M6 — artifact en split : la conversation reste visible dessous.
              P3.11 — hauteur bornée pour les petits écrans. */}
          {activeArtifact && (
            <AiArtifactPanel
              artifact={activeArtifact}
              onClose={() => setActiveArtifact(null)}
              className="h-[62%] min-h-[240px] max-h-[78%] shrink-0 border-b border-border/60 max-md:h-[72%]"
            />
          )}

          {/* Rules panel — full overlay */}
          {chat.rulesPanelOpen && (
            <FocusScope
              className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background"
              onEscape={() => chat.setRulesPanelOpen(false)}
            >
              <AiRulesPanel
                workspaceId={activeWorkspaceId}
                onClose={() => chat.setRulesPanelOpen(false)}
              />
            </FocusScope>
          )}

          {/* Permissions panel — full overlay */}
          {chat.permissionsPanelOpen && (
            <FocusScope
              className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background"
              onEscape={() => chat.setPermissionsPanelOpen(false)}
            >
              <AiPermissionsPopover onClose={() => chat.setPermissionsPanelOpen(false)} />
            </FocusScope>
          )}

          {/* History panel — full-height slide-in */}
          {history.historyOpen && (
            <FocusScope
              className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background animate-in slide-in-from-top-2 duration-150"
              onEscape={() => history.setHistoryOpen(false)}
            >
              <div className="flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-sm">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="size-3.5 text-primary" />
                  {t("ai.history.title")}
                </span>
                <button
                  type="button"
                  onClick={() => history.setHistoryOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t("common.close")}
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
            </FocusScope>
          )}

          {/* ── Messages ──────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto" ref={chat.messagesEndRef}>
            <div className="space-y-5 p-4">
              {/* Empty state */}
              {chat.messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                  <div className="relative">
                    <div className="flex size-14 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Sparkles className="size-6" />
                    </div>
                    {!configured && (
                      <span
                        className="absolute -right-1.5 -top-1 size-3 rounded-full bg-warning ring-2 ring-background"
                        aria-hidden
                      />
                    )}
                  </div>

                  {configured ? (
                    <>
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
                              className="group/sugg flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            >
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover/sugg:bg-primary/15">
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

                      {/* F10 — découvrabilité des commandes et du contexte */}
                      <p className="mt-4 text-[11px] text-muted-foreground/70">
                        <kbd className="rounded border border-border/60 bg-muted/60 px-1 font-mono">/</kbd>{" "}
                        ·{" "}
                        <kbd className="rounded border border-border/60 bg-muted/60 px-1 font-mono">@</kbd>{" "}
                        {t("ai.sidebar.shortcutsHint")}
                      </p>
                    </>
                  ) : (
                    /* M8 — sans clé configurée : CTA proactif au lieu de suggestions vouées à l'échec */
                    <>
                      <p className="mt-5 text-sm font-semibold text-foreground">
                        {t("ai.sidebar.configTitle")}
                      </p>
                      <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-muted-foreground">
                        {t("ai.sidebar.configDesc")}
                      </p>
                      <Button asChild size="sm" className="mt-5 gap-1.5">
                        <Link href="/settings#ai" data-testid="ai-sidebar-empty-config-cta">
                          <Key className="size-3.5" />
                          {t("ai.sidebar.configCta", { defaultValue: "Configurer l'accès IA" })}
                        </Link>
                      </Button>
                    </>
                  )}

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
                  onConfirm={(_stepId, confirmed, all) => chat.confirmAction(confirmed, all)}
                  confirmBusy={chat.confirmBusy}
                  onTypingUpdate={chat.scrollToBottom}
                  onExecuteRequest={chat.requestCodeExecution}
                  onArtifactOpen={setActiveArtifact}
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

              {/* Error banner — P1.4/P2.5 : copie + actions contextuelles */}
              {chat.error && (
                <div className="mr-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span className="flex-1 select-text break-words">{chat.error}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void navigator.clipboard.writeText(chat.error ?? "")}
                      className="size-6 shrink-0 [&_svg]:size-3 text-destructive hover:text-destructive/80"
                      title={t("ai.sidebar.copyError")}
                      aria-label={t("ai.sidebar.copyError")}
                    >
                      <Copy className="size-3" />
                    </Button>
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

                  {/* Actions contextuelles selon le code d'erreur classifié */}
                  {(chat.errorCode === "auth_invalid" ||
                    chat.errorCode === "quota_exceeded" ||
                    chat.errorCode === "model_not_found") && (
                    <div className="mt-2 flex gap-1.5">
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                        <Link href="/settings#ai">{t("ai.sidebar.configCta")}</Link>
                      </Button>
                    </div>
                  )}
                  {chat.errorCode === "context_too_long" && (
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => chat.runSlashCommand("compact", "")}
                      >
                        {t("ai.sidebar.actionCompact")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          handleNewSession();
                          setActiveArtifact(null);
                        }}
                      >
                        {t("ai.history.new")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Missing AI config — guided setup CTA (R19) */}
              {chat.missingConfig && (
                <div
                  className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning mr-6"
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

          {/* B0 — le panneau artefact est rendu en SPLIT plus haut (ligne ~302) ;
              l'ancien overlay plein écran (rendu en double) est supprimé. */}

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
            files={chat.files}
            onAddFiles={(fl) => void chat.attachFiles(fl)}
            onRemoveFile={chat.removeFile}
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
