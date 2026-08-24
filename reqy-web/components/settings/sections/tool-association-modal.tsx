"use client";

import { useState, type ComponentType, type FormEvent, type SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { useToast } from "@/hooks/use-toast";
import { useOAuthConnect, type DeviceFlowInit } from "@/hooks/use-oauth-connect";
import { isOAuthTool } from "@/hooks/use-tool-connections";
import { isTauriAvailable } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";

export interface Tool {
  id: string;
  name: string;
  description?: string;
  logo?: ComponentType<SVGProps<SVGSVGElement>>;
  scopes?: string[];
  oauthUrl?: string;
  apiKey?: {
    endpoint: string;
    placeholder: string;
    instructions?: string;
  };
}

interface ToolAssociationModalProps {
  tool: Tool | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
  connected?: boolean;
}

function ApiKeyForm({ tool, onSuccess }: { tool: Tool; onSuccess: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const config = tool.apiKey!;

  const isValid =
    tool.id === "jina"
      ? /^jina_[A-Za-z0-9_-]+$/.test(apiKey.trim())
      : /^PMAK-[A-Za-z0-9_-]+$/.test(apiKey.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError(
        tool.id === "jina"
          ? t("settings.integrations.apiKeyError.jina")
          : t("settings.integrations.apiKeyError.postman"),
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("settings.integrations.apiKeyRejected"));
        return;
      }
      toast({
        title: t("common.connected"),
        description: t("settings.integrations.associated", { name: tool.name }),
      });
      onSuccess();
    } catch {
      setError(t("settings.integrations.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="mb-1 font-medium">{t("settings.integrations.howToGetKey")}</p>
        <p className="text-muted-foreground">
          {t(`settings.integrations.${tool.id}.instructions`)}
        </p>
      </div>
      <div className="space-y-1.5">
        <Field>
          <FieldLabel htmlFor="api-key">{t("settings.integrations.apiKeyLabel")}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="api-key"
              type={show ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError(null);
              }}
              placeholder={config.placeholder}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? t("settings.integrations.hide") : t("settings.integrations.show")}
            >
              {show ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
            </Button>
          </div>
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!isValid || loading}>
          {loading
            ? t("settings.integrations.validating")
            : t("settings.integrations.validateAndConnect")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function OAuthFlow({
  tool,
  onOpenChange,
  onConnected,
}: {
  tool: Tool;
  onOpenChange: (v: boolean) => void;
  onConnected?: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [deviceInit, setDeviceInit] = useState<DeviceFlowInit | null>(null);
  const tauri = isTauriAvailable();
  const { start, waitForToken } = useOAuthConnect(
    tauri && isOAuthTool(tool.id) ? tool.id : "github",
  );
  const native = tauri && isOAuthTool(tool.id);
  async function handleAssociate() {
    if (native) {
      setLoading(true);
      try {
        const init = await start();
        setDeviceInit(init);
        await invoke("open_external", {
          url: init.verification_uri_complete ?? init.verification_uri,
        });
        await waitForToken(init);
        toast({
          title: t("common.connected"),
          description: t("settings.integrations.associated", { name: tool.name }),
        });
        onOpenChange(false);
        onConnected?.();
      } catch (err) {
        toast({
          title: t("settings.integrations.connectionFailed"),
          description: err instanceof Error ? err.message : String(err),
        });
        setLoading(false);
      }
      return;
    }

    if (!tool.oauthUrl) {
      toast({
        title: t("settings.integrations.soonTitle"),
        description: t("settings.integrations.soonDesc", { name: tool.name }),
      });
      onOpenChange(false);
      return;
    }
    setLoading(true);
    window.location.href = tool.oauthUrl;
  }

  return (
    <>
      {(() => {
        const scopes = t(`settings.integrations.${tool.id}.scopes`, { returnObjects: true });
        const list = Array.isArray(scopes) ? scopes : [];
        return list.length ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">{t("settings.integrations.requestedScopes")}</p>
            <ul className="space-y-1 text-muted-foreground">
              {list.map((s) => (
                <li key={s} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })()}
      {deviceInit && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="mb-2 font-medium">
            {t("settings.integrations.enterCode", {
              host: new URL(deviceInit.verification_uri).host,
            })}
          </p>
          <p className="mb-2 text-center font-mono text-2xl tracking-[0.3em]">
            {deviceInit.user_code}
          </p>
          <p className="text-muted-foreground">{t("settings.integrations.browserOpened")}</p>
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleAssociate} disabled={loading}>
          {loading
            ? native
              ? deviceInit
                ? t("settings.integrations.waitingAuth")
                : t("settings.integrations.connecting")
              : t("settings.integrations.redirecting")
            : `${t("settings.integrations.associateName", { name: tool.name })} →`}
        </Button>
      </DialogFooter>
    </>
  );
}

function DisconnectView({ tool, onDisconnected }: { tool: Tool; onDisconnected: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const tauri = isTauriAvailable();
  const { disconnect } = useOAuthConnect(tauri && isOAuthTool(tool.id) ? tool.id : "github");
  const native = tauri && isOAuthTool(tool.id);
  const endpoint =
    tool.id === "github"
      ? "/api/github-auth/logout"
      : tool.id === "gitlab"
        ? "/api/gitlab-auth/logout"
        : tool.id === "postman"
          ? "/api/postman-auth"
          : tool.id === "jina"
            ? "/api/jina-auth"
            : null;

  async function handleDisconnect() {
    setLoading(true);
    try {
      if (native) {
        await disconnect();
      } else {
        if (!endpoint) return;
        const res = await fetch(endpoint, { method: "DELETE", credentials: "include" });
        if (!res.ok) throw new Error();
      }
      toast({
        title: t("settings.integrations.disconnectedToast"),
        description: t("settings.integrations.disconnectedDesc", { name: tool.name }),
      });
      onDisconnected();
    } catch {
      toast({ title: t("common.error"), description: t("settings.integrations.disconnectFailed") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("settings.integrations.currentlyConnected", { name: tool.name })}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={() => onDisconnected()}>
          {t("common.close")}
        </Button>
        <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
          {loading
            ? t("settings.integrations.disconnecting")
            : t("settings.integrations.disconnect")}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ToolAssociationModal({
  tool,
  open,
  onOpenChange,
  onConnected,
  connected,
}: ToolAssociationModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {tool && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                {tool.logo && (
                  <tool.logo
                    className="max-h-8 max-w-8 h-auto w-auto shrink-0"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <DialogTitle>
                    {connected
                      ? tool.name
                      : t("settings.integrations.associateName", { name: tool.name })}
                  </DialogTitle>
                  <DialogDescription>
                    {t(`settings.integrations.${tool.id}.description`)}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            {connected ? (
              <DisconnectView
                tool={tool}
                onDisconnected={() => {
                  onOpenChange(false);
                  onConnected?.();
                }}
              />
            ) : tool.apiKey ? (
              <ApiKeyForm
                tool={tool}
                onSuccess={() => {
                  onOpenChange(false);
                  onConnected?.();
                }}
              />
            ) : (
              <OAuthFlow
                tool={tool}
                onOpenChange={onOpenChange}
                onConnected={() => {
                  onOpenChange(false);
                  onConnected?.();
                }}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
