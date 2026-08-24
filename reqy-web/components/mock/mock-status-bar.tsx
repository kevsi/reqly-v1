"use client";

import { useState } from "react";
import { Activity, ChevronDown, Loader2, Pause, PlugZap, RotateCcw, Unplug } from "lucide-react";
import type { MockAdminSettings } from "@/lib/mock/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const K = {
  connected: "mocks.status.connected",
  offline: "mocks.status.offline",
  checking: "mocks.status.checking",
  routesCount: "mocks.status.routesCount",
  connect: "mocks.status.connect",
  connecting: "mocks.status.connecting",
  baseUrl: "mocks.status.baseUrl",
  baseUrlPh: "mocks.status.baseUrlPlaceholder",
  token: "mocks.status.token",
  tokenPh: "mocks.status.tokenPlaceholder",
  disconnect: "mocks.status.disconnect",
  resetState: "mocks.status.resetState",
  pollingActive: "mocks.status.pollingActive",
  pollingPaused: "mocks.status.pollingPaused",
  formTitle: "mocks.status.formTitle",
} as const;

export interface AttachState {
  status: "unknown" | "connected" | "offline";
  name: string | null;
  routesCount: number;
}

interface MockStatusBarProps {
  attach: AttachState;
  settings: MockAdminSettings | null;
  /** Compact connection form visibility (controlled by the page). */
  connectOpen: boolean;
  onConnectOpenChange: (open: boolean) => void;
  pollingActive: boolean;
  onTogglePolling: () => void;
  onConnect: (base: string, token: string) => Promise<boolean>;
  onDisconnect: () => void;
  onReset: () => void;
}

export function MockStatusBar({
  attach,
  settings,
  connectOpen,
  onConnectOpenChange,
  pollingActive,
  onTogglePolling,
  onConnect,
  onDisconnect,
  onReset,
}: MockStatusBarProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [base, setBase] = useState(settings?.base ?? "");
  const [token, setToken] = useState(settings?.token ?? "");

  async function submit() {
    if (!base.trim() || !token.trim() || submitting) return;
    setSubmitting(true);
    const ok = await onConnect(base, token);
    setSubmitting(false);
    if (ok) onConnectOpenChange(false);
  }

  const statusLabel =
    attach.status === "connected"
      ? t(K.connected, { defaultValue: "Connecté" }) + (attach.name ? ` · ${attach.name}` : "")
      : attach.status === "offline"
        ? t(K.offline, { defaultValue: "Hors-ligne" })
        : t(K.checking, { defaultValue: "Recherche du mock…" });

  return (
    <div className="sticky top-0 z-20 border-b bg-background/85 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
            attach.status === "connected" &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
            attach.status === "offline" && "border-red-500/30 bg-red-500/10 text-red-600",
            attach.status === "unknown" && "border-amber-500/30 bg-amber-500/10 text-amber-600",
          )}
          role="status"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              attach.status === "connected" && "animate-pulse bg-emerald-500",
              attach.status === "offline" && "bg-red-500",
              attach.status === "unknown" && "bg-amber-500",
            )}
          />
          {statusLabel}
          {attach.status === "connected" && (
            <span className="font-mono text-[11px] opacity-80">
              ·{" "}
              {t(K.routesCount, {
                defaultValue: "{{count}} routes",
                count: attach.routesCount,
              })}
            </span>
          )}
          {attach.status === "unknown" && (
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
          )}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onTogglePolling}
            aria-label={
              pollingActive
                ? t(K.pollingActive, { defaultValue: "Polling actif — mettre en pause" })
                : t(K.pollingPaused, { defaultValue: "Polling en pause — reprendre" })
            }
          >
            {pollingActive ? (
              <Pause aria-hidden="true" className="size-3.5" />
            ) : (
              <Activity aria-hidden="true" className="size-3.5 text-primary" />
            )}
          </Button>
          {attach.status !== "connected" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onConnectOpenChange(!connectOpen)}
              aria-expanded={connectOpen}
            >
              <PlugZap aria-hidden="true" className="size-3.5" />
              {t(K.connect, { defaultValue: "Connecter" })}
              <ChevronDown
                aria-hidden="true"
                className={cn("size-3 transition-transform", connectOpen && "rotate-180")}
              />
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onReset}
            disabled={attach.status !== "connected"}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {t(K.resetState, { defaultValue: "Reset state" })}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onDisconnect}
            disabled={!settings}
          >
            <Unplug aria-hidden="true" className="size-3.5" />
            {t(K.disconnect, { defaultValue: "Déconnecter" })}
          </Button>
        </div>
      </div>

      {connectOpen && (
        <form
          className="mt-2.5 flex flex-wrap items-end gap-2 rounded-lg border bg-card/60 p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="w-full text-xs font-medium text-muted-foreground">
            {t(K.formTitle, { defaultValue: "Mock en cours (`recli mock start`)" })}
          </p>
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor={`msb-base`} className="text-xs text-muted-foreground">
              {t(K.baseUrl, { defaultValue: "Base URL" })}
            </Label>
            <Input
              id={`msb-base`}
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder={t(K.baseUrlPh, { defaultValue: "http://127.0.0.1:4015" })}
              className="h-8 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="flex w-44 flex-col gap-1">
            <Label htmlFor={`msb-token`} className="text-xs text-muted-foreground">
              {t(K.token, { defaultValue: "Token admin" })}
            </Label>
            <Input
              id={`msb-token`}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t(K.tokenPh, { defaultValue: "x-admin-token" })}
              className="h-8 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={submitting}>
            {submitting ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <PlugZap aria-hidden="true" className="size-3.5" />
            )}
            {submitting
              ? t(K.connecting, { defaultValue: "Connexion…" })
              : t(K.connect, { defaultValue: "Connecter" })}
          </Button>
        </form>
      )}
    </div>
  );
}
