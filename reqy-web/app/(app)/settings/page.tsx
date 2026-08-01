"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Bell, Sparkles, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { cn } from "@/lib/utils";
import { useRequestStore } from "@/hooks/use-request-store";
import { persistence } from "@/lib/persistence";
import {
  AIProvider,
  loadAIProvider,
  loadApiKey,
  saveAIProvider,
  saveApiKey,
  loadOllamaConfig,
  saveOllamaConfig,
  loadAiBaseUrl,
  saveAiBaseUrl,
  loadAiModel,
  saveAiModel,
} from "@/lib/config";

import { toast } from "@/hooks/use-toast";
import { SettingsLayout } from "@/components/settings/settings-layout";
import type { SettingsSection } from "@/components/settings/settings-sidebar";
import { ApparenceSection } from "@/components/settings/sections/apparence-section";
import { ToolsSection } from "@/components/settings/sections/tools-section";
import { KeyboardSection } from "@/components/settings/sections/keyboard-section";
import { ModulesSection } from "@/components/settings/sections/modules-section";
import McpSection from "@/components/settings/mcp-section";

const AISection = dynamic(() => import("@/components/settings/ai-section"), { ssr: false });
const NotificationsSection = dynamic(() => import("@/components/settings/notifications-section"), {
  ssr: false,
});

const AI_PROVIDERS: Array<{ value: AIProvider; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "grok", label: "Grok" },
  { value: "ollama", label: "Ollama" },
  { value: "opencode-zen", label: "Opencode Zen" },
  { value: "custom", label: "Custom" },
];

type SectionKey = SettingsSection;

const SECTION_KEYS: SectionKey[] = [
  "apparence",
  "ai",
  "notifications",
  "integrations",
  "keyboard",
  "mcp",
  "modules",
];

export default function SettingsPage() {
  const {
    systemNotificationPermission,
    requestSystemNotificationPermission,
    aiAutoApply,
    setAiAutoApply,
  } = useRequestStore();
  const [showAiConfirm, setShowAiConfirm] = useState(false);
  const [provider, setProvider] = useState<AIProvider>(() =>
    typeof window !== "undefined" ? loadAIProvider() : "openai",
  );
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== "undefined" ? loadApiKey(loadAIProvider()) : "",
  );
  const [aiBaseUrl, setAiBaseUrl] = useState(() =>
    typeof window !== "undefined" ? loadAiBaseUrl(loadAIProvider()) : "",
  );
  const [aiModel, setAiModel] = useState(() =>
    typeof window !== "undefined" ? loadAiModel(loadAIProvider()) : "",
  );
  const [ollamaHost, setOllamaHost] = useState(() =>
    typeof window !== "undefined" ? loadOllamaConfig().host || "127.0.0.1" : "127.0.0.1",
  );
  const [ollamaPort, setOllamaPort] = useState(() =>
    typeof window !== "undefined" ? loadOllamaConfig().port?.toString() || "11434" : "11434",
  );
  const [ollamaModel, setOllamaModel] = useState(() =>
    typeof window !== "undefined" ? loadOllamaConfig().model || "llama2" : "llama2",
  );
  const [simpleMode, setSimpleMode] = useState(() =>
    typeof window !== "undefined"
      ? persistence.getItem<boolean>("reqly_simple_mode") === true
      : false,
  );
  const handleSimpleModeChange = (val: boolean) => {
    setSimpleMode(val);
    try {
      void persistence.setItem("reqly_simple_mode", val);
    } catch {
      /* ignore */
    }
  };
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<
    "loading" | "connected" | "disconnected" | "error"
  >("loading");
  const [githubUser, setGithubUser] = useState<{
    login: string;
    name?: string;
    avatar_url?: string;
  } | null>(null);
  const [postmanStatus, setPostmanStatus] = useState<
    "loading" | "connected" | "disconnected" | "error"
  >("loading");
  const [postmanUser, setPostmanUser] = useState<{
    id: string;
    name?: string;
    email?: string;
  } | null>(null);
  const [postmanApiKey, setPostmanApiKey] = useState<string>("");
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubConnectDialogOpen, setGithubConnectDialogOpen] = useState(false);
  const [postmanConnecting, setPostmanConnecting] = useState(false);

  // Lire les erreurs d'auth GitHub OAuth depuis l'URL (après redirection callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("github_auth_error");
    if (authError) {
      toast({
        title: "Erreur de connexion GitHub",
        description: authError,
        variant: "destructive",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("github_auth_error");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const [activeSection, setActiveSection] = useState<SectionKey>(() => {
    if (typeof window !== "undefined") {
      const h = window.location.hash?.replace("#", "") as SectionKey;
      if (SECTION_KEYS.includes(h)) return h;
    }
    return "ai";
  });

  // Push/toast notification settings
  const [pushEnabled, setPushEnabled] = useState<boolean>(
    typeof window !== "undefined" && persistence.getItem<string>("probe_push_enabled") === "true",
  );
  const [systemPushEnabled, setSystemPushEnabled] = useState<boolean>(
    typeof window !== "undefined" &&
      persistence.getItem<string>("probe_system_push_enabled") === "true",
  );
  const [notifyEvents, setNotifyEvents] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof window === "undefined") {
        return {
          requestComplete: true,
          collectionComplete: true,
          aiResponse: true,
          aiError: true,
          importExport: true,
        };
      }
      const raw = persistence.getItem<Record<string, boolean>>("probe_push_events");
      if (!raw)
        return {
          requestComplete: true,
          collectionComplete: true,
          aiResponse: true,
          aiError: true,
          importExport: true,
        };
      if (typeof raw === "string") return JSON.parse(raw);
      return raw as Record<string, boolean>;
    } catch {
      return {
        requestComplete: true,
        collectionComplete: true,
        aiResponse: true,
        aiError: true,
        importExport: true,
      };
    }
  });

  // Sync active section with URL hash
  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash?.replace("#", "") as SectionKey;
      if (SECTION_KEYS.includes(h)) setActiveSection(h);
      else setActiveSection("ai");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    try {
      window.history.replaceState(null, "", `#${activeSection}`);
    } catch {
      /* ignore */
    }
  }, [activeSection]);

  // Auto-dismiss save status + toast notification
  useEffect(() => {
    if (saveStatus) {
      toast({ title: "Succès", description: saveStatus });
      const timer = window.setTimeout(() => setSaveStatus(null), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [saveStatus]);

  // AI handlers
  const handleProviderChange = useCallback((value: AIProvider) => {
    setProvider(value);
    setApiKey(loadApiKey(value));
    setAiBaseUrl(loadAiBaseUrl(value));
    setAiModel(loadAiModel(value));
    if (value === "ollama") {
      const config = loadOllamaConfig();
      setOllamaHost(config.host || "127.0.0.1");
      setOllamaPort(config.port?.toString() || "11434");
      setOllamaModel(config.model || "llama2");
    }
  }, []);

  const handleSaveAIConfig = useCallback(() => {
    saveAIProvider(provider);
    saveApiKey(provider, apiKey);
    saveAiBaseUrl(provider, aiBaseUrl);
    saveAiModel(provider, aiModel);
    saveOllamaConfig({
      host: ollamaHost || "127.0.0.1",
      port: Number(ollamaPort) || 11434,
      model: ollamaModel || "llama2",
    });
    const savedConfig = loadOllamaConfig();
    setOllamaHost(savedConfig.host || "127.0.0.1");
    setOllamaPort(savedConfig.port?.toString() || "11434");
    setOllamaModel(savedConfig.model || "llama2");
    setSaveStatus(`Configuration enregistrée pour ${provider.toUpperCase()}`);
  }, [provider, apiKey, aiBaseUrl, aiModel, ollamaHost, ollamaPort, ollamaModel]);

  // GitHub handlers
  const connectGithub = useCallback(() => {
    setGithubConnecting(true);
    setGithubStatus("loading");
    setGithubConnectDialogOpen(true);
    const githubWindow = window.open("/api/github-auth/start", "_blank", "noopener,noreferrer");
    if (!githubWindow) window.location.href = "/api/github-auth/start";
  }, []);

  const disconnectGithub = useCallback(async () => {
    try {
      await fetch("/api/github-auth/logout", { method: "POST" });
      setGithubStatus("disconnected");
      setGithubUser(null);
      setSaveStatus("Déconnexion GitHub enregistrée");
    } catch {
      setSaveStatus("Impossible de déconnecter GitHub");
    }
  }, []);

  const fetchGithubStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/github-auth/status");
      if (!response.ok) throw new Error("Échec");
      const data = await response.json();
      if (data.connected) {
        setGithubStatus("connected");
        setGithubUser(data.user || null);
        setGithubConnecting(false);
        setGithubConnectDialogOpen(false);
      } else {
        setGithubStatus("disconnected");
        setGithubUser(null);
      }
    } catch {
      setGithubStatus("error");
      setGithubUser(null);
    }
  }, []);

  const fetchPostmanStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/postman-auth/status", {
        headers: { ...proxyAuthHeaders() },
      });
      if (!response.ok) throw new Error("Échec");
      const data = await response.json();
      if (data.connected) {
        setPostmanStatus("connected");
        setPostmanUser(data.user || null);
      } else {
        setPostmanStatus("disconnected");
        setPostmanUser(null);
      }
    } catch {
      setPostmanStatus("error");
      setPostmanUser(null);
    }
  }, []);

  // Initial status fetch
  useEffect(() => {
    const statusTimeout = window.setTimeout(() => {
      void Promise.all([fetchGithubStatus(), fetchPostmanStatus()]);
    }, 0);
    return () => window.clearTimeout(statusTimeout);
  }, [fetchGithubStatus, fetchPostmanStatus]);

  useEffect(() => {
    const onFocus = () => {
      fetchGithubStatus();
      fetchPostmanStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchGithubStatus, fetchPostmanStatus]);

  // Postman handlers
  const connectPostman = useCallback(async () => {
    if (!postmanApiKey.trim()) {
      toast({
        title: "Clé API requise",
        description: "Veuillez saisir votre clé API Postman.",
        variant: "destructive",
      });
      return;
    }
    setPostmanStatus("loading");
    setPostmanConnecting(true);
    try {
      const response = await fetch("/api/postman-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: postmanApiKey.trim() }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setPostmanStatus("error");
        toast({
          title: "Erreur",
          description: err.message || "Clé API Postman invalide",
          variant: "destructive",
        });
        return;
      }
      const data = await response.json();
      setPostmanStatus("connected");
      setPostmanUser(data.user);
      toast({
        title: "Postman connecté",
        description: `Bienvenue ${data.user?.name || "utilisateur"}!`,
      });
    } catch {
      setPostmanStatus("error");
      toast({
        title: "Erreur",
        description: "Impossible de se connecter à Postman",
        variant: "destructive",
      });
    } finally {
      setPostmanConnecting(false);
    }
  }, [postmanApiKey]);

  const disconnectPostman = useCallback(async () => {
    try {
      await fetch("/api/postman-auth/logout", { method: "POST" });
      setPostmanStatus("disconnected");
      setPostmanUser(null);
      setPostmanApiKey("");
      toast({ title: "Postman déconnecté", description: "Votre connexion a été supprimée" });
    } catch {
      toast({
        title: "Erreur",
        description: "Impossible de déconnecter Postman",
        variant: "destructive",
      });
    }
  }, []);

  // Notification handlers
  const togglePushEnabled = useCallback(async () => {
    const next = !pushEnabled;
    if (next) {
      try {
        await requestSystemNotificationPermission();
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de demander la permission.",
          variant: "destructive",
        });
        return;
      }
    }
    setPushEnabled(next);
    try {
      void persistence.setItem("probe_push_enabled", next ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [pushEnabled, requestSystemNotificationPermission]);

  const toggleSystemPushEnabled = useCallback(() => {
    setSystemPushEnabled((prev) => {
      const next = !prev;
      try {
        void persistence.setItem("probe_system_push_enabled", next ? "true" : "false");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleRequestSystemPermission = useCallback(async () => {
    try {
      await requestSystemNotificationPermission();
    } catch {
      toast({
        title: "Erreur",
        description: "Impossible de demander la permission.",
        variant: "destructive",
      });
    }
  }, [requestSystemNotificationPermission]);

  const toggleNotifyEvent = useCallback(
    (key: string) => {
      const next = { ...notifyEvents, [key]: !notifyEvents[key] };
      setNotifyEvents(next);
      try {
        void persistence.setItem("probe_push_events", next);
      } catch {
        /* ignore */
      }
    },
    [notifyEvents],
  );

  const handleTestPush = useCallback(() => {
    try {
      toast({ title: "Test de notification (toast)", meta: { event: "importExport" } });
    } catch {
      /* ignore */
    }
  }, []);

  // Profile handlers moved into ProfileSection (self-contained)

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-6">
        <SettingsLayout active={activeSection} onChange={setActiveSection}>
          {activeSection === "apparence" ? <ApparenceSection /> : null}
          {activeSection === "ai" ? (
            <AISection
              provider={provider}
              apiKey={apiKey}
              aiModel={aiModel}
              aiBaseUrl={aiBaseUrl}
              ollamaHost={ollamaHost}
              ollamaPort={ollamaPort}
              ollamaModel={ollamaModel}
              aiAutoApply={aiAutoApply}
              showAiConfirm={showAiConfirm}
              aiProviders={AI_PROVIDERS}
              onProviderChange={handleProviderChange}
              onSaveConfig={handleSaveAIConfig}
              setApiKey={setApiKey}
              setAiModel={setAiModel}
              setAiBaseUrl={setAiBaseUrl}
              setOllamaHost={setOllamaHost}
              setOllamaPort={setOllamaPort}
              setOllamaModel={setOllamaModel}
              setAiAutoApply={setAiAutoApply}
              setShowAiConfirm={setShowAiConfirm}
              simpleMode={simpleMode}
              setSimpleMode={handleSimpleModeChange}
            />
          ) : null}
          {activeSection === "notifications" ? (
            <NotificationsSection
              pushEnabled={pushEnabled}
              notifyEvents={notifyEvents}
              systemPushEnabled={systemPushEnabled}
              systemNotificationPermission={systemNotificationPermission}
              onTogglePush={togglePushEnabled}
              onToggleEvent={toggleNotifyEvent}
              onToggleSystemPush={toggleSystemPushEnabled}
              onRequestSystemPermission={handleRequestSystemPermission}
              onTestPush={handleTestPush}
            />
          ) : null}
          {activeSection === "integrations" ? <ToolsSection /> : null}
          {activeSection === "keyboard" ? <KeyboardSection /> : null}
          {activeSection === "mcp" ? <McpSection /> : null}
          {activeSection === "modules" ? <ModulesSection /> : null}
        </SettingsLayout>
      </div>

      <Dialog
        open={githubConnectDialogOpen}
        onOpenChange={(open) => {
          setGithubConnectDialogOpen(open);
          if (!open) setGithubConnecting(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connexion GitHub</DialogTitle>
            <DialogDescription>
              Une nouvelle fenêtre GitHub s'ouvre pour l'authentification.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex items-center gap-3 text-sm text-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p>Patientez pendant la redirection vers GitHub...</p>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={() => setGithubConnectDialogOpen(false)}>
              J'ai terminé
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
