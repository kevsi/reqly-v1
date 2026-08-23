"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Moon, Sun, LogOut, PlugZap, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { syncApi, monitorApi } from "@/lib/api";
import type { AdminConfig } from "@/lib/config";

export function SettingsSection({
  config,
  onSave,
  onDisconnect,
  dark,
  onToggleTheme,
}: {
  config: AdminConfig;
  onSave: (cfg: AdminConfig) => void;
  onDisconnect: () => void;
  dark: boolean;
  onToggleTheme: (dark: boolean) => void;
}) {
  const [syncBase, setSyncBase] = useState(config.syncBase);
  const [syncToken, setSyncToken] = useState(config.syncToken);
  const [monitorBase, setMonitorBase] = useState(config.monitorBase);
  const [monitorToken, setMonitorToken] = useState(config.monitorToken);
  const [testing, setTesting] = useState(false);

  async function testConnections(cfg: AdminConfig) {
    setTesting(true);
    try {
      await syncApi(cfg).stats();
      toast.success("Sync-server : connexion OK");
    } catch {
      toast.error("Sync-server : échec (URL ou token invalide)");
    }
    if (cfg.monitorBase.trim() && cfg.monitorToken.trim()) {
      try {
        await monitorApi(cfg).health();
        toast.success("Monitoring : connexion OK");
      } catch {
        toast.error("Monitoring : échec");
      }
    }
    setTesting(false);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Réglages</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Connexions API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Sync-server — base URL</Label>
            <Input
              type="url"
              value={syncBase}
              onChange={(e) => setSyncBase(e.target.value)}
              placeholder="https://reqly.duckdns.org"
            />
            <Input
              type="password"
              value={syncToken}
              onChange={(e) => setSyncToken(e.target.value)}
              placeholder="ADMIN_TOKEN"
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Monitoring (optionnel)</Label>
            <Input
              type="url"
              value={monitorBase}
              onChange={(e) => setMonitorBase(e.target.value)}
              placeholder="https://reqly.duckdns.org/monitor"
            />
            <Input
              type="password"
              value={monitorToken}
              onChange={(e) => setMonitorToken(e.target.value)}
              placeholder="ADMIN_TOKEN monitor"
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="gap-1.5"
              disabled={testing}
              onClick={() => {
                const cfg: AdminConfig = {
                  syncBase: syncBase.trim(),
                  syncToken: syncToken.trim(),
                  monitorBase: monitorBase.trim(),
                  monitorToken: monitorToken.trim(),
                };
                onSave(cfg);
                void testConnections(cfg);
              }}
            >
              <PlugZap className="size-4" /> Enregistrer & tester
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Apparence</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-sm">Thème sombre</span>
          <div className="flex items-center gap-2">
            {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
            <Switch checked={dark} onCheckedChange={onToggleTheme} />
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={onDisconnect}
      >
        <LogOut className="size-4" /> Se déconnecter
      </Button>
    </div>
  );
}

export function ConnectionDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <CheckCircle2 className="size-3.5 text-muted-foreground" />;
  return ok ? (
    <CheckCircle2 className="size-3.5 text-primary" />
  ) : (
    <XCircle className="size-3.5 text-destructive" />
  );
}
