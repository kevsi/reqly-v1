"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";

import { useRequestStore } from "@/hooks/use-request-store";
import { persistence } from "@/lib/persistence";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { systemNotificationPermission, requestSystemNotificationPermission } = useRequestStore();
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
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Lire les erreurs d'auth GitHub OAuth depuis l'URL (après redirection callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("github_auth_error");
    if (authError) {
      toast({
        title: t("settings.github.connectError"),
        description: authError,
        variant: "destructive",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("github_auth_error");
      window.history.replaceState(null, "", url.toString());
    }
  }, [t]);

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
      toast({ title: t("settings.saveSuccess"), description: saveStatus });
      const timer = window.setTimeout(() => setSaveStatus(null), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [saveStatus, t]);

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
    try {
      window.dispatchEvent(new CustomEvent("ai-config-changed"));
    } catch {
      /* ignore */
    }
    setSaveStatus(t("settings.configSavedFor", { provider: provider.toUpperCase() }));
  }, [provider, apiKey, aiBaseUrl, aiModel, ollamaHost, ollamaPort, ollamaModel, t]);

  // Notification handlers
  const togglePushEnabled = useCallback(async () => {
    const next = !pushEnabled;
    if (next) {
      try {
        await requestSystemNotificationPermission();
      } catch {
        toast({
          title: t("settings.permissionErrorTitle"),
          description: t("settings.permissionErrorDesc"),
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
  }, [pushEnabled, requestSystemNotificationPermission, t]);

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
        title: t("settings.permissionErrorTitle"),
        description: t("settings.permissionErrorDesc"),
        variant: "destructive",
      });
    }
  }, [requestSystemNotificationPermission, t]);

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
      toast({ title: t("settings.testNotification"), meta: { event: "importExport" } });
    } catch {
      /* ignore */
    }
  }, [t]);

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
              aiProviders={AI_PROVIDERS}
              onProviderChange={handleProviderChange}
              onSaveConfig={handleSaveAIConfig}
              setApiKey={setApiKey}
              setAiModel={setAiModel}
              setAiBaseUrl={setAiBaseUrl}
              setOllamaHost={setOllamaHost}
              setOllamaPort={setOllamaPort}
              setOllamaModel={setOllamaModel}
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
    </>
  );
}
