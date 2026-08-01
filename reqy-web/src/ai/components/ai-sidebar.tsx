"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useCallback } from "react";
import { Sparkles, PanelRightClose, Clock, Loader2, GripVerticalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationSession } from "@/src/ai/components/ai-sidebar-types";
import { AiHistoryPanel } from "@/src/ai/components/ai-history-panel";
import { AiChatMessage } from "@/src/ai/components/ai-chat-message";
import { AiChatInput } from "@/src/ai/components/ai-chat-input";
import { useAiSidebarWidth } from "@/src/ai/hooks/use-ai-sidebar-width";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";
import { useAiSidebarHistory } from "@/src/ai/hooks/use-ai-sidebar-history";

// ── Component ──────────────────────────────────────────────────────────────

interface AiSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function AiSidebar({ open, onClose }: AiSidebarProps) {
  const { width, isResizing, sidebarRef, handleResizeStart } = useAiSidebarWidth();
  const chat = useAiSidebarChat();
  const history = useAiSidebarHistory(chat.messages);

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

  // ── Handlers combining chat + history ────────────────────────────────────

  const handleSelectSession = useCallback(
    (session: ConversationSession) => {
      history.handleLoadSessionMessages(session, chat.handleNewMessages);
    },
    [history, chat],
  );

  const handleNewSession = useCallback(() => {
    history.handleNewSession();
    chat.clearMessages();
  }, [history, chat]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      if (id === history.currentSessionId) {
        chat.clearMessages();
      }
      history.handleDeleteSession(id);
    },
    [history, chat],
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
          "relative flex flex-col border-l border-border bg-background",
          "h-screen shrink-0 overflow-hidden",
          "transition-[width] duration-200 ease-out",
          isResizing && "transition-none",
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
        <div className="flex items-center justify-between border-b border-border px-4 h-12 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-semibold">Assistant IA</span>
          </div>
          <div className="flex items-center gap-1">
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
                <Sparkles className="size-10 mb-3 text-primary/40" />
                <p className="text-sm font-medium">Assistant IA</p>
                <p className="text-xs mt-1 max-w-[240px]">
                  Demande-moi d'exécuter des requêtes, gérer des collections, ou naviguer dans
                  l'application.
                </p>
                <div className="mt-4 space-y-1.5">
                  {[
                    "Exécute GET /api/users",
                    "Crée une collection 'Tests API'",
                    "Importe le projet depuis GitHub",
                  ].map((hint) => (
                    <Button
                      key={hint}
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        chat.setInput(hint);
                        chat.inputRef.current?.focus();
                      }}
                      className="block w-full justify-start rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {hint}
                    </Button>
                  ))}
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
              />
            ))}

            {chat.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-6">
                <Loader2 className="size-3.5 animate-spin" />
                Réflexion…
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
          value={chat.input}
          onValueChange={chat.setInput}
          onSend={chat.handleSend}
          isLoading={chat.isLoading}
          inputRef={chat.inputRef}
        />
      </div>
    </>
  );
}
