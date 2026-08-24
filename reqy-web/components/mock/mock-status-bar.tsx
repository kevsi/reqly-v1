"use client";

import { useState } from "react";
import {
  Activity,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Pause,
  PlugZap,
  RotateCcw,
  Unplug,
} from "lucide-react";
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
  openConnect: "mocks.status.openConnect",
  routesCount: "mocks.status.routesCount",
  ping: "mocks.status.ping",
  connect: "mocks.status.connect",
  connecting: "mocks.status.connecting",
  baseUrl: "mocks.status.baseUrl",
  baseUrlPh: "mocks.status.baseUrlPlaceholder",
  invalidUrl: "mocks.status.invalidUrl",
  token: "mocks.status.token",
  tokenPh: "mocks.status.tokenPlaceholder",
  tokenShow: "mocks.status.tokenShow",
  tokenHide: "mocks.status.tokenHide",
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
  /** Round-trip of the last admin health check, in ms (null when unreachable). */
  pingMs?: number | null;
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

const URL_PATTERN = /^https?:\/\//i;

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
  const [showToken, setShowToken] = useState(false);
  const [base, setBase] = useState(settings?.base ?? "");
  const [token, setToken] = useState(settings?.token ?? "");

  const urlOk = URL_PATTERN.test(base.trim());
  async function submit() {
    if (!urlOk || !base.trim() || !token.trim() || submitting) return;
    setSubmitting(true);
    const ok = await onConnect(base, token);
    setSubmitting(false);
    if (ok) onConnectOpenChange(false);
  }

  const port = settings?.base.match(/:(\d+)\/?$/)?.[1] ?? null;
  const statusLabel =
    attach.status === "connected"
      ? t(K.connected, { defaultValue: "Connecté" }) + (attach.name ? ` · ${attach.name}` : "")
      : attach.status === "offline"
        ? t(K.offline, { defaultValue: "Hors-ligne" })
        : t(K.checking, { defaultValue: "Recherche du mock…" });

  return (
    <div className="bg-background/85 sticky top-0 z-20 border-b px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        {attach.status !== "connected" ? (
          // Hors-ligne / recherche : le statut est cliquable et ouvre le formulaire de connexion.
          <button
            type="button"
            onClick={() => onConnectOpenChange(true)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150 hover:brightness-95",
              attach.status === "offline" &&
                "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
              attach.status === "unknown" &&
                "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
            aria-label={t(K.openConnect, { defaultValue: "Ouvrir la connexion au mock" })}
            title={t(K.openConnect, { defaultValue: "Ouvrir la connexion au mock" })}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                attach.status === "offline" && "bg-red-500",
                attach.status === "unknown" && "animate-pulse bg-amber-500",
              )}
            />
            {statusLabel}
            {attach.status === "unknown" && (
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            )}
          </button>
        ) : (
          <span
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
            role="status"
          >
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            {statusLabel}
            {port && <span className="font-mono text-[11px] opacity-80">:{port}</span>}
            <span
              className="font-mono text-[11px] tabular-nums opacity-80"
              title={t(K.ping, { defaultValue: "Latence du mock" })}
            >
              · {attach.pingMs != null ? `${attach.pingMs} ms` : "—"}
            </span>
            <span className="font-mono text-[11px] opacity-80">
              ·{" "}
              {t(K.routesCount, {
                defaultValue: "{{count}} routes",
                count: attach.routesCount,
              })}
            </span>
          </span>
        )}

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
            title={
              pollingActive
                ? t(K.pollingActive, { defaultValue: "Polling actif — mettre en pause" })
                : t(K.pollingPaused, { defaultValue: "Polling en pause — reprendre" })
            }
          >
            {pollingActive ? (
              <Pause aria-hidden="true" className="size-3.5" />
            ) : (
              <Activity aria-hidden="true" className="text-primary size-3.5" />
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
          <p className="text-muted-foreground w-full text-xs font-medium">
            {t(K.formTitle, { defaultValue: "Mock en cours (`recli mock start`)" })}
          </p>
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor={`msb-base`} className="text-muted-foreground text-xs">
              {t(K.baseUrl, { defaultValue: "Base URL" })}
            </Label>
            <Input
              id={`msb-base`}
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder={t(K.baseUrlPh, { defaultValue: "http://127.0.0.1:4015" })}
              className={cn(
                "h-8 font-mono text-xs",
                base.trim() !== "" && !urlOk && "border-destructive focus-visible:ring-destructive/40",
              )}
              aria-invalid={base.trim() !== "" && !urlOk}
              spellCheck={false}
              autoComplete="off"
            />
            {base.trim() !== "" && !urlOk && (
              <p className="text-destructive text-[11px]" role="alert">
                {t(K.invalidUrl, {
                  defaultValue: "L'URL doit commencer par http:// ou https://.",
                })}
              </p>
            )}
          </div>
          <div className="flex w-44 flex-col gap-1">
            <Label htmlFor={`msb-token`} className="text-muted-foreground text-xs">
              {t(K.token, { defaultValue: "Token admin" })}
            </Label>
            <div className="relative">
              <Input
                id={`msb-token`}
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t(K.tokenPh, { defaultValue: "x-admin-token" })}
                className="h-8 pr-8 font-mono text-xs"
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
                onClick={() => setShowToken((v) => !v)}
                aria-label={
                  showToken
                    ? t(K.tokenHide, { defaultValue: "Masquer le token" })
                    : t(K.tokenShow, { defaultValue: "Afficher le token" })
                }
                title={
                  showToken
                    ? t(K.tokenHide, { defaultValue: "Masquer le token" })
                    : t(K.tokenShow, { defaultValue: "Afficher le token" })
                }
              >
                {showToken ? (
                  <EyeOff aria-hidden="true" className="size-3.5" />
                ) : (
                  <Eye aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            className="h-8 text-xs"
            disabled={submitting || !urlOk || !token.trim()}
          >
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
