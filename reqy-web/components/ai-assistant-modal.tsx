"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, Send, ChevronsUpDown, Check, Bot, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageActions } from "@/components/message-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useRequestStore } from "@/hooks/use-request-store";
import {
  loadApiKey,
  saveApiKey,
  loadAIProvider,
  loadOllamaConfig,
  loadAiModel,
  loadAiBaseUrl,
} from "@/lib/config";
import { isAiConfigured, DEFAULT_MODELS } from "@/lib/ai-config";
import { streamLLM } from "@/src/ai/cloud-engine/llm";
import type { RequestContext } from "@/src/ai/types";
import { ProgressiveMarkdown } from "@/src/ai/components/progressive-markdown";
import { toast } from "@/hooks/use-toast";
import { fireSystemNotification, pushInAppNotification } from "@/lib/system-notifications";
import { cn } from "@/lib/utils";
import { persistence } from "@/lib/persistence";

// Contexte de requête vide : requis par le typage de streamLLM, ignoré car
// `rawMessage` est fourni (constante de module pour rester pur pendant le rendu).
const EMPTY_REQUEST_CTX: RequestContext = {
  request: { method: "GET", url: "", headers: {}, body: undefined, authType: "none" },
  timestamp: 0,
};

const SUGGESTIONS = [
  "ai.legacy.suggestion1",
  "ai.legacy.suggestion2",
  "ai.legacy.suggestion3",
  "ai.legacy.suggestion4",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id?: string;
}

interface ConversationSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

export function AiAssistantModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { history, projects, selectedProjectId, setSelectedProject, addNotification } =
    useRequestStore();
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  const provider = loadAIProvider();
  const apiKey = loadApiKey(provider);

  const isProviderConfigured = isAiConfigured();

  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessageRef = useRef<string | null>(null);

  const currentHistory = history.slice(0, 5);

  const routeSummary = (() => {
    if (!selectedProject) {
      if (projects.length === 0)
        return "Aucun projet disponible. Ajoute un projet dans Mes Projets.";
      return "Sélectionne un projet actif pour voir les routes disponibles.";
    }
    const routes = selectedProject.routes.slice(0, 8);
    if (routes.length === 0) return "Aucun endpoint détecté";
    return routes
      .map((route: { method: string; path: string }) => `${route.method} ${route.path}`)
      .join("\n");
  })();

  const requestSummary =
    currentHistory.length === 0
      ? "Aucun appel récent"
      : currentHistory
          .map(
            (item) =>
              `${item.method} ${item.endpoint} → ${item.responseStatus ?? "-"} (${item.responseTime ?? "-"}ms)`,
          )
          .join("\n");

  const getSessionTitle = useCallback((msgs: ChatMessage[]) => {
    const firstUserMessage = msgs.find((message) => message.role === "user")?.content;
    if (!firstUserMessage) return `Conversation du ${new Date().toLocaleDateString()}`;
    return firstUserMessage.length > 40 ? `${firstUserMessage.slice(0, 40)}...` : firstUserMessage;
  }, []);

  const loadConversationHistory = () => {
    if (typeof window === "undefined") return [];
    try {
      const raw = persistence.getItem<string>("ai-conversation-history");
      return raw ? (JSON.parse(raw) as ConversationSession[]) : [];
    } catch {
      return [];
    }
  };

  const saveConversationHistory = (historyData: ConversationSession[]) => {
    if (typeof window === "undefined") return;
    try {
      void persistence.setItem("ai-conversation-history", JSON.stringify(historyData));
    } catch {
      /* ignore */
    }
  };

  const addMessagesToSession = useCallback(
    (updatedMessages: ChatMessage[]) => {
      if (currentSessionId) {
        setConversationHistory((prev) =>
          prev.map((session) =>
            session.id === currentSessionId
              ? {
                  ...session,
                  title: getSessionTitle(updatedMessages),
                  messages: updatedMessages,
                }
              : session,
          ),
        );
        return;
      }

      const newSession: ConversationSession = {
        id: `session-${Date.now()}-${Math.random()}`,
        title: getSessionTitle(updatedMessages),
        messages: updatedMessages,
        createdAt: Date.now(),
      };
      setCurrentSessionId(newSession.id);
      setConversationHistory((prev) => [newSession, ...prev]);
    },
    [currentSessionId, getSessionTitle, setCurrentSessionId, setConversationHistory],
  );

  const loadSession = (sessionId: string) => {
    const session = conversationHistory.find((item) => item.id === sessionId);
    if (!session) return;
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setHistoryOpen(false);
  };

  const startNewConversation = () => {
    setMessages([]);
    setEditingIndex(null);
    setEditingText("");
    setCurrentSessionId(null);
    setHistoryOpen(false);
  };

  useEffect(() => {
    const loadTimeout = window.setTimeout(() => {
      setConversationHistory(loadConversationHistory());
    }, 0);

    return () => window.clearTimeout(loadTimeout);
  }, []);

  useEffect(() => {
    saveConversationHistory(conversationHistory);
  }, [conversationHistory]);

  const getOllamaConfig = () => {
    const config = loadOllamaConfig();
    return {
      host: config.host || "127.0.0.1",
      port: config.port || 11434,
      model: config.model || "llama2",
    };
  };

  const systemInstructions = (() => {
    const selectedProjectInfo = selectedProject
      ? `Projet sélectionné : ${selectedProject.name} (${selectedProject.framework})\nPort : ${selectedProject.port ?? "inconnu"}\nRoutes détectées : ${selectedProject.routes.length}`
      : "Aucun projet sélectionné.";

    return `Tu es ReqlyAI, un assistant API spécialisé.
Tu aides les développeurs à diagnostiquer des erreurs HTTP, comprendre des réponses,
et améliorer leurs requêtes. Tu réponds en français, de façon concise et actionnable.
Quand tu suggères un fix, donne le code exact prêt à coller.

Contexte actuel :
${selectedProjectInfo}

Routes détectées :
${routeSummary}

Historique des appels :
${requestSummary}`;
  })();

  const sendMessage = async (prompt: string) => {
    // Configuration alignée sur le moteur (use-ai-engine / parseAiConfig).
    const ollama = getOllamaConfig();
    const configuredModel = loadAiModel(provider);
    const model = configuredModel.trim()
      ? configuredModel.trim()
      : provider === "ollama"
        ? ollama.model || DEFAULT_MODELS.ollama
        : DEFAULT_MODELS[provider];
    const config = {
      provider,
      apiKey: provider === "ollama" ? "" : apiKey.trim(),
      model,
      openaiUrl:
        provider === "openai" || provider === "custom" || provider === "grok"
          ? loadAiBaseUrl(provider) || undefined
          : undefined,
      host: provider === "ollama" ? ollama.host || "127.0.0.1" : undefined,
      port: provider === "ollama" ? ollama.port || 11434 : undefined,
    };

    // Bulle placeholder vide : montée avant la réponse pour que la révélation
    // progressive du texte s'enclenche (et que le spinner s'affiche dedans
    // pendant que le modèle génère).
    const assistantId = crypto.randomUUID();
    setMessages((prev) => {
      const updatedMessages = [
        ...prev,
        { role: "assistant" as const, content: "", id: assistantId },
      ];
      addMessagesToSession(updatedMessages);
      return updatedMessages;
    });

    let fullText = "";
    try {
      // Streaming réel : chaque token reçu met à jour la bulle au fur et à
      // mesure, comme ChatGPT/Claude. La révélation progressive (`ProgressiveMarkdown`)
      // lisse le rendu quand le provider renvoie tout d'un coup (Ollama, Tauri…).
      const stream = streamLLM({
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        openaiUrl: config.openaiUrl,
        host: config.host,
        port: config.port,
        system: systemInstructions,
        rawMessage: prompt,
        // Requis par le typage de streamLLM ; ignoré car `rawMessage` est fourni.
        question: prompt,
        ctx: EMPTY_REQUEST_CTX,
      });
      for await (const token of stream) {
        if (token.type === "text") {
          fullText += token.value;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m)),
          );
        }
      }
    } catch (err) {
      // Retirer la bulle placeholder : l'erreur est signalée par le toast de
      // l'appelant (handleSend / handleRetryMessage).
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      throw err;
    }

    const finalText = fullText || "L'IA n'a pas renvoyé de réponse.";
    setMessages((prev) => {
      const updatedMessages = prev.map((m) =>
        m.id === assistantId ? { ...m, content: finalText } : m,
      );
      addMessagesToSession(updatedMessages);
      return updatedMessages;
    });

    try {
      addNotification?.({ title: t("ai.legacy.responseReceived"), body: finalText, type: "info" });
      fireSystemNotification({
        title: t("ai.legacy.responseReceived"),
        body: finalText.length > 120 ? `${finalText.slice(0, 117)}...` : finalText,
        event: "aiResponse",
        tag: "ai-response",
      });
    } catch {
      // ignore notification failures
    }
  };

  const handleSend = async () => {
    const effectivePrompt = pendingMessageRef.current ?? query;
    pendingMessageRef.current = null;
    const prompt = effectivePrompt.trim();
    if (!prompt) return;
    if (provider !== "ollama" && !isProviderConfigured) {
      toast({ title: t("ai.legacy.configureFirst"), variant: "destructive" });
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: prompt, id: crypto.randomUUID() };
    setMessages((prev) => {
      const updatedMessages = [...prev, userMessage];
      addMessagesToSession(updatedMessages);
      return updatedMessages;
    });
    try {
      addNotification?.({ title: t("ai.legacy.messageSent"), body: prompt, type: "info" });
    } catch {
      // ignore notification failures
    }

    setQuery("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);

    try {
      if (provider !== "ollama") saveApiKey(provider, apiKey);
      await sendMessage(prompt);
    } catch (error) {
      toast({
        title: t("ai.legacy.errorPrefix", { error: String(error) }),
        variant: "destructive",
        meta: { event: "aiError" },
      });
      fireSystemNotification({
        title: t("ai.legacy.errorTitle"),
        body: String(error).slice(0, 120),
        event: "aiError",
        tag: "ai-error",
      });
      pushInAppNotification({
        title: "Erreur IA",
        body: String(error).slice(0, 200),
        type: "error",
        event: "aiError",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEditMessage = (index: number) => {
    if (messages[index].role === "user") {
      setEditingIndex(index);
      setEditingText(messages[index].content);
      setQuery(messages[index].content);
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingText("");
    setQuery("");
  };

  const handleConfirmEdit = async () => {
    if (!editingText.trim()) {
      handleCancelEdit();
      return;
    }

    const editedContent = editingText;

    const newMessages = messages.slice(0, editingIndex ?? 0);
    setMessages(newMessages);
    setEditingIndex(null);
    setEditingText("");

    pendingMessageRef.current = editedContent;
    setQuery(editedContent);
    handleSend();
  };

  const handleRetryMessage = async (assistantMessageIndex: number) => {
    let lastUserMessageIndex = -1;
    for (let i = assistantMessageIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) return;

    const lastUserMessage = messages[lastUserMessageIndex].content;

    const newMessages = messages.slice(0, assistantMessageIndex);
    setMessages(newMessages);

    setQuery(lastUserMessage);
    setLoading(true);

    try {
      if (provider !== "ollama") saveApiKey(provider, apiKey);
      await sendMessage(lastUserMessage);
    } catch (error) {
      toast({
        title: t("ai.legacy.errorPrefix", { error: String(error) }),
        variant: "destructive",
        meta: { event: "aiError" },
      });
      fireSystemNotification({
        title: t("ai.legacy.errorTitle"),
        body: String(error).slice(0, 120),
        event: "aiError",
        tag: "ai-error",
      });
      pushInAppNotification({
        title: "Erreur IA",
        body: String(error).slice(0, 200),
        type: "error",
        event: "aiError",
      });
    } finally {
      setLoading(false);
      setQuery("");
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  // Ne force le défilement que si l'utilisateur est déjà proche du bas, pour ne
  // pas le tirer vers le bas pendant qu'il remonte lire du contenu. Utilisé par
  // l'effet sur `messages` ET par la révélation progressive du texte (chaque
  // mot révélé fait grandir la bulle sans changer `messages`).
  const scrollToBottom = useCallback(() => {
    const el = messagesEndRef.current?.parentElement;
    if (!el) return;
    const threshold = 80;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,760px)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-3xl">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-card">
              <Sparkles className="size-4 text-foreground" />
            </div>
            <span className="truncate font-semibold text-sm text-foreground">Monu IA</span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-2 border-dashed font-normal">
                  <div className="size-2 rounded-full bg-muted-foreground" />
                  <span className="max-w-[120px] truncate text-foreground">
                    {selectedProject ? selectedProject.name : t("ai.legacy.noProject")}
                  </span>
                  <ChevronsUpDown className="size-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[220px]">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t("ai.legacy.projects")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setSelectedProject(p.id)}
                    className="flex items-center gap-2"
                  >
                    <span className="truncate flex-1">{p.name}</span>
                    {selectedProjectId === p.id && <Check className="size-3.5 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={startNewConversation}
              title={t("ai.legacy.newConversation")}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-2xl border border-border bg-card px-2 text-sm text-foreground transition hover:border-primary/50 hover:bg-primary/5 sm:px-3"
            >
              <Plus className="size-4 sm:hidden" />
              <span className="hidden sm:inline">Nouvelle conversation</span>
            </button>

            <button
              type="button"
              onClick={() => setHistoryOpen((prev) => !prev)}
              title={historyOpen ? "Fermer l'historique" : "Historique"}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-2xl border border-border bg-card px-2 text-sm text-foreground transition hover:border-primary/50 hover:bg-primary/5 sm:px-3"
            >
              <Clock className="size-4 sm:hidden" />
              <span className="hidden sm:inline">
                {historyOpen ? "Fermer l'historique" : "Historique"}
              </span>
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col bg-background">
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center space-y-6 px-4 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                  <Sparkles className="size-8 text-foreground" />
                </div>
                <div className="max-w-2xl">
                  <h2 className="text-3xl font-semibold text-foreground">Assistant IA</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Pose une question à Monu IA et reçois des recommandations précises pour tes
                    APIs, tests et endpoints.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 max-w-3xl w-full">
                  {SUGGESTIONS.map((key) => (
                    <button
                      key={key}
                      onClick={() => setQuery(t(key))}
                      className="rounded-3xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground shadow-sm transition hover:border-primary/40 hover:bg-accent"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 pb-4">
                {messages.map((message, index) => (
                  <div
                    key={message.id ?? index}
                    className={cn(
                      "flex gap-4",
                      message.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <>
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Bot className="size-5 text-foreground" />
                        </div>
                        <div className="group/message relative max-w-[85%] rounded-[28px] border border-border bg-card px-5 py-4 text-[15px] text-foreground shadow-sm">
                          {loading && !message.content && index === messages.length - 1 ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="size-4 animate-spin text-primary" />
                              <span>{t("ai.legacy.thinking")}</span>
                            </div>
                          ) : (
                            <ProgressiveMarkdown
                              content={message.content}
                              className="text-[15px]"
                              onTextChange={scrollToBottom}
                            />
                          )}
                          {message.content && (
                            <MessageActions
                              messageId={`msg-${index}`}
                              content={message.content}
                              role="assistant"
                              onRetry={() => handleRetryMessage(index)}
                              isEditing={editingIndex === index}
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="group/message relative max-w-[85%]">
                          {editingIndex === index ? (
                            <div className="rounded-[28px] bg-card px-5 py-4 text-[15px] text-foreground shadow-sm border border-border">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full resize-none rounded-lg border border-border bg-muted/20 p-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                                rows={2}
                              />
                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={handleConfirmEdit}
                                  disabled={!editingText.trim()}
                                  className="flex-1 rounded-lg bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/20 disabled:opacity-50"
                                >
                                  Valider
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="flex-1 rounded-lg bg-muted/10 px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted/20"
                                >
                                  Annuler
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-[28px] bg-primary/10 px-5 py-4 text-[15px] text-primary shadow-sm border border-border">
                              <p className="whitespace-pre-wrap leading-relaxed">
                                {message.content}
                              </p>
                            </div>
                          )}
                          {editingIndex !== index && (
                            <MessageActions
                              messageId={`msg-${index}`}
                              content={message.content}
                              role="user"
                              onEdit={() => handleEditMessage(index)}
                              isEditing={editingIndex === index}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="bg-background px-4 pb-6 pt-4 shrink-0">
            <div className="mx-auto w-full max-w-3xl">
              <div className="sticky bottom-0 z-10 rounded-[32px] border border-border bg-card/90 px-4 py-4 shadow-[0_0_0_1px_rgba(148,163,184,0.08)] backdrop-blur-xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <textarea
                    ref={textareaRef}
                    value={query}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    className="min-h-[48px] flex-1 resize-none rounded-2xl border border-border bg-background/80 px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/10"
                    placeholder={t("ai.legacy.placeholder")}
                    rows={1}
                  />
                  <Button
                    onClick={handleSend}
                    disabled={loading || !query.trim()}
                    aria-label={t("ai.legacy.send")}
                    className="ml-3 h-12 rounded-2xl px-4 text-sm font-medium shadow-sm transition hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {loading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t("ai.legacy.send")}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Send className="size-4" />
                        <span>{t("ai.legacy.send")}</span>
                      </div>
                    )}
                  </Button>
                </div>
                <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>{t("ai.legacy.disclaimer")}</span>
                  <span>{t("ai.legacy.inputHint")}</span>
                </div>
              </div>
            </div>
          </div>
        </main>

        {historyOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative mx-4 w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lg max-h-[80vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-300">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Historique des conversations
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Charge une conversation précédente ou commence-en une nouvelle.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="absolute right-4 top-4 rounded-lg text-muted-foreground transition hover:text-foreground"
                  aria-label="Fermer"
                >
                  ✕
                </button>
              </div>

              {conversationHistory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 p-4 text-center text-sm text-muted-foreground">
                  Aucune conversation enregistrée.
                </div>
              ) : (
                <div className="space-y-2">
                  {conversationHistory.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => loadSession(session.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-2xl border px-4 py-3 text-left text-sm transition",
                        currentSessionId === session.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:border-primary/50 hover:bg-primary/5",
                      )}
                    >
                      <span className="font-medium text-foreground">{session.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(session.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-6 flex gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:border-primary/50 hover:bg-primary/5"
                >
                  Fermer
                </button>
                {conversationHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setConversationHistory([]);
                      startNewConversation();
                    }}
                    className="flex-1 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20"
                  >
                    Effacer tout
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
