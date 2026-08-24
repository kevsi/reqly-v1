"use client";

import { useCallback, useEffect, useState } from "react";
import type { MockConfig } from "@reqly/mock-engine";
import {
  checkMockAlive,
  clearMockAdminSettings,
  loadMockAdminSettings,
  pushMockConfig,
  resetMockState,
  saveMockAdminSettings,
  type MockAdminSettings,
} from "@/lib/mock/admin-client";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { AttachState } from "./mock-status-bar";

const K = {
  connectedToast: "mocks.status.connectedToast",
  connectFailedToast: "mocks.status.connectFailedToast",
  disconnectedToast: "mocks.status.disconnectedToast",
  resetOkToast: "mocks.status.resetOkToast",
  resetKoToast: "mocks.status.resetKoToast",
  applySuccess: "mocks.actions.applySuccess",
  applyFailed: "mocks.actions.applyFailed",
} as const;

const PING_INTERVAL_MS = 15000;

/** Connection lifecycle to a running mock: attach state, settings, ping loop, admin actions. */
export function useMockAdmin(config: MockConfig | null) {
  const { t } = useTranslation();
  const [attach, setAttach] = useState<AttachState>({
    status: "unknown",
    name: null,
    routesCount: 0,
    pingMs: null,
  });
  const [settings, setSettings] = useState<MockAdminSettings | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pollingActive, setPollingActive] = useState(true);

  // Hydratation initiale : settings admin > hors-ligne, avec mesure du ping.
  useEffect(() => {
    const saved = loadMockAdminSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration from storage
    setSettings(saved);
    setConnectOpen(!saved);
    if (!saved) {
      setAttach({ status: "offline", name: null, routesCount: 0, pingMs: null });
      return;
    }
    void (async () => {
      const start = Date.now();
      const alive = await checkMockAlive(saved);
      if (alive.ok) {
        setAttach({
          status: "connected",
          name: alive.data.name,
          routesCount: alive.data.routesCount,
          pingMs: Date.now() - start,
        });
      } else {
        setAttach({ status: "offline", name: null, routesCount: 0, pingMs: null });
      }
    })();
  }, []);

  // Ping régulier du mock connecté (affiché dans la barre de statut).
  useEffect(() => {
    if (!settings || attach.status !== "connected") return;
    let cancelled = false;
    async function ping() {
      if (!settings) return;
      const start = Date.now();
      const alive = await checkMockAlive(settings);
      if (cancelled) return;
      setAttach((prev) => ({
        ...prev,
        pingMs: alive.ok ? Date.now() - start : null,
      }));
    }
    void ping();
    const handle = window.setInterval(() => void ping(), PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [settings, attach.status]);

  const handleConnect = useCallback(
    async (base: string, token: string): Promise<boolean> => {
      const candidate: MockAdminSettings = {
        base: base.trim().replace(/\/+$/, ""),
        token: token.trim(),
      };
      const start = Date.now();
      const alive = await checkMockAlive(candidate);
      if (!alive.ok) {
        setAttach({ status: "offline", name: null, routesCount: 0, pingMs: null });
        toast({
          title: t(K.connectFailedToast, {
            defaultValue: "Mock introuvable — vérifie l'URL et le token.",
          }),
          description: alive.hint,
          variant: "destructive",
        });
        return false;
      }
      saveMockAdminSettings(candidate);
      setSettings(candidate);
      setAttach({
        status: "connected",
        name: alive.data.name,
        routesCount: alive.data.routesCount,
        pingMs: Date.now() - start,
      });
      toast({
        title: t(K.connectedToast, { defaultValue: "Mock connecté" }),
        description: candidate.base,
      });
      return true;
    },
    [t],
  );

  function handleDisconnect() {
    clearMockAdminSettings();
    setSettings(null);
    setAttach({ status: "offline", name: null, routesCount: 0, pingMs: null });
    setConnectOpen(true);
    toast({ title: t(K.disconnectedToast, { defaultValue: "Mock déconnecté" }) });
  }

  async function handleReset() {
    if (!settings) return;
    const ok = await resetMockState(settings);
    toast({
      title: ok
        ? t(K.resetOkToast, { defaultValue: "État du mock réinitialisé" })
        : t(K.resetKoToast, { defaultValue: "Reset impossible" }),
      variant: ok ? "default" : "destructive",
    });
  }

  async function handleApply(): Promise<boolean> {
    if (!settings || !config) return false;
    const result = await pushMockConfig(settings, config);
    toast({
      title: result.ok
        ? t(K.applySuccess, { defaultValue: "Config appliquée au mock" })
        : t(K.applyFailed, {
            defaultValue: "Application impossible : {{message}}",
            message: result.message ?? `HTTP ${result.status}`,
          }),
      variant: result.ok ? "default" : "destructive",
    });
    return result.ok;
  }

  function togglePolling() {
    setPollingActive((v) => !v);
  }

  return {
    attach,
    settings,
    connectOpen,
    setConnectOpen,
    pollingActive,
    togglePolling,
    handleConnect,
    handleDisconnect,
    handleReset,
    handleApply,
  };
}
