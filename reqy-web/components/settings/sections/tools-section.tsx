"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToolAssociationModal, type Tool } from "./tool-association-modal";
import { buildMcpClientConfig } from "@/lib/mcp/config";
import { isTauriAvailable, setBandwidthLimit } from "@/lib/tauri";
import { persistence } from "@/lib/persistence";
import { secureKeys } from "@/lib/secure-storage";
import {
  useToolConnections,
  OAUTH_TOKEN_KEYS,
  isOAuthTool,
  type ConnectionStatus,
} from "@/hooks/use-tool-connections";
import { Plug, Cloud, Wifi } from "lucide-react";
import { PostmanIcon } from "@/components/icons/postman";
import { GithubIcon } from "@/components/icons/github";
import { GitlabIcon } from "@/components/icons/gitlab";
import { JinaIcon } from "@/components/icons/jina";

const TOOLS: Tool[] = [
  {
    id: "postman",
    name: "Postman",
    description: "Import et export de collections Postman.",
    logoEmoji: "📬",
    logo: PostmanIcon,
    scopes: [],
    apiKey: {
      endpoint: "/api/postman-auth",
      placeholder: "PMAK-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      instructions:
        "Allez sur go.postman.co → Settings → API Keys → Generate API Key. Copiez la clé (elle commence par PMAK-).",
    },
  },
  {
    id: "jina",
    name: "Jina AI",
    description: "Embeddings sémantiques pour la recherche intelligente.",
    logo: JinaIcon,
    scopes: [],
    apiKey: {
      endpoint: "/api/jina-auth",
      placeholder: "jina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      instructions:
        "Allez sur api.jina.ai → API Keys → Create API Key. " +
        "Copiez la clé (elle commence par jina_).",
    },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Accès à vos repositories et gists.",
    logoEmoji: "🐙",
    logo: GithubIcon,
    scopes: ["Lecture de vos repositories", "Lecture de votre profil", "Création de gists"],
    oauthUrl: "/api/github-auth/start",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Accès à vos repositories et profil GitLab.",
    logoEmoji: "🦊",
    logo: GitlabIcon,
    scopes: ["Lecture de vos repositories", "Lecture de votre profil"],
    oauthUrl: "/api/gitlab-auth/start",
  },
];

function useToolStatus(toolId: string, refreshKey = 0): ConnectionStatus {
  const storeStatus = useToolConnections((s) => (isOAuthTool(toolId) ? s[toolId] : "loading"));
  const setStoreStatus = useToolConnections((s) => s.setStatus);
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  useEffect(() => {
    let cancelled = false;
    // GitHub/GitLab in the desktop app: the encrypted secure store is the
    // source of truth (the Next.js status routes don't exist in the static
    // production build).
    if (isOAuthTool(toolId)) {
      (async () => {
        await secureKeys.waitForReady();
        if (cancelled) return;
        const connected = !!secureKeys.get(OAUTH_TOKEN_KEYS[toolId]);
        const next: ConnectionStatus = connected ? "connected" : "disconnected";
        setStatus(next);
        setStoreStatus(toolId, next);
      })();
      return () => {
        cancelled = true;
      };
    }
    const url =
      toolId === "postman"
        ? "/api/postman-auth/status"
        : toolId === "jina"
          ? "/api/jina-auth/status"
          : null;
    if (!url) {
      setStatus("disconnected");
      return;
    }
    fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStatus(data.connected ? "connected" : "disconnected");
      })
      .catch(() => {
        if (!cancelled) setStatus("disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, [toolId, refreshKey, setStoreStatus]);
  return isOAuthTool(toolId) ? storeStatus : status;
}

function ToolRow({
  tool,
  refreshKey,
  onAssociate,
}: {
  tool: Tool;
  refreshKey: number;
  onAssociate: (connected: boolean) => void;
}) {
  const status = useToolStatus(tool.id, refreshKey);
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          {tool.logo ? (
            <tool.logo className="max-h-5 max-w-5 h-auto w-auto" aria-hidden="true" />
          ) : (
            <span className="text-lg leading-none" aria-hidden="true">
              {tool.logoEmoji}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{tool.name}</p>
          <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {status === "loading" ? (
          <span className="size-2 animate-pulse rounded-full bg-muted-foreground/30" />
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              status === "connected"
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                status === "connected" ? "bg-success" : "bg-muted-foreground",
              )}
            />
            {status === "connected" ? "Connecté" : "Non connecté"}
          </span>
        )}
        <Button
          size="sm"
          variant={status === "connected" ? "outline" : "default"}
          onClick={() => onAssociate(status === "connected")}
        >
          {status === "connected" ? "Gérer" : "Associer"}
        </Button>
      </div>
    </div>
  );
}

export function ToolsSection() {
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [activeConnected, setActiveConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  // Bandwidth throttle (capture proxy) — optional, desktop-only.
  const tauriAvailable = isTauriAvailable();
  const [throttleEnabled, setThrottleEnabled] = useState(false);
  const [throttleKbps, setThrottleKbps] = useState("50");
  const [throttleStatus, setThrottleStatus] = useState<string | null>(null);

  // SSL verification (desktop only): when off, the Tauri fetch uses the
  // insecure reqwest client that skips certificate validation.
  const [sslEnabled, setSslEnabled] = useState(true);
  useEffect(() => {
    const v = persistence.getItem<boolean>("reqly_ssl_verification_enabled");
    if (typeof v === "boolean") setSslEnabled(v);
  }, []);
  const setSslVerification = async (value: boolean) => {
    setSslEnabled(value);
    try {
      await persistence.setItem("reqly_ssl_verification_enabled", value);
    } catch {
      /* ignore */
    }
  };

  const applyThrottle = async () => {
    try {
      if (!throttleEnabled) {
        await setBandwidthLimit(null);
        setThrottleStatus("Débit non limité");
      } else {
        const kbps = Number(throttleKbps);
        if (!Number.isFinite(kbps) || kbps <= 0) {
          setThrottleStatus("Valeur invalide (ko/s > 0)");
          return;
        }
        await setBandwidthLimit(kbps);
        setThrottleStatus(`Débit limité à ${kbps} ko/s`);
      }
    } catch {
      setThrottleStatus("Non disponible hors de l'application desktop");
    }
  };

  const copyMcpConfig = async () => {
    const config = buildMcpClientConfig("claude-desktop");
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
          <Plug className="size-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold">Outils connectés</h2>
          <p className="text-sm text-muted-foreground">
            Connectez vos services tiers pour importer et synchroniser vos données.
          </p>
        </div>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border bg-card px-4 shadow-sm">
        {TOOLS.map((tool) => (
          <ToolRow
            key={tool.id}
            tool={tool}
            refreshKey={refreshKey}
            onAssociate={(connected) => {
              setActiveTool(tool);
              setActiveConnected(connected);
              setOpen(true);
            }}
          />
        ))}
      </div>
      <ToolAssociationModal
        tool={activeTool}
        open={open}
        onOpenChange={setOpen}
        onConnected={() => setRefreshKey((k) => k + 1)}
        connected={activeConnected}
      />
      <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Cloud className="size-4 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Intégrations MCP</h3>
            <p className="text-sm text-muted-foreground">
              Connectez le serveur MCP local de Reqly à Claude Desktop ou Cursor. Copiez la
              configuration ci-dessous et collez-la dans le fichier de configuration de votre
              client.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="default" onClick={copyMcpConfig}>
            Copier la config MCP
          </Button>
          <a
            href="/mcp-setup.md"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary hover:underline"
          >
            Documentation MCP
          </a>
          {copied ? (
            <span className="text-sm font-medium text-success" role="status" aria-live="polite">
              Copié !
            </span>
          ) : null}
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <Wifi className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Réseau</h3>
            <p className="text-sm text-muted-foreground">
              Limitez le débit des réponses capturées pour simuler un réseau contraint (proxy de
              capture, application desktop uniquement).
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id="ssl-toggle"
            checked={sslEnabled}
            onCheckedChange={setSslVerification}
            disabled={!tauriAvailable}
          />
          <label htmlFor="ssl-toggle" className="text-sm">
            Vérification SSL/TLS (désactiver pour les certificats auto-signés)
          </label>
          {!tauriAvailable ? (
            <span className="text-xs text-muted-foreground/70">
              Disponible uniquement dans l'application desktop.
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id="throttle-toggle"
            checked={throttleEnabled}
            onCheckedChange={setThrottleEnabled}
            disabled={!tauriAvailable}
          />
          <label htmlFor="throttle-toggle" className="text-sm">
            Limiter le débit (ko/s)
          </label>
          <Input
            type="number"
            min={1}
            value={throttleKbps}
            onChange={(e) => setThrottleKbps(e.target.value)}
            disabled={!throttleEnabled || !tauriAvailable}
            className="h-8 w-24"
            aria-label="Débit en ko/s"
          />
          <Button size="sm" variant="outline" onClick={applyThrottle} disabled={!tauriAvailable}>
            Appliquer
          </Button>
          {throttleStatus ? (
            <span
              className="text-xs font-medium text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {throttleStatus}
            </span>
          ) : null}
          {!tauriAvailable ? (
            <span className="text-xs text-muted-foreground/70">
              Disponible uniquement dans l'application desktop.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
