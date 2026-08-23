"use client";

import { useState } from "react";
import { KeyRound, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminConfig } from "@/lib/config";

export function LoginGate({
  initial,
  onConnect,
}: {
  initial: AdminConfig;
  onConnect: (cfg: AdminConfig) => void;
}) {
  const [syncBase, setSyncBase] = useState(initial.syncBase);
  const [syncToken, setSyncToken] = useState(initial.syncToken);
  const [monitorBase, setMonitorBase] = useState(
    initial.monitorBase || "https://reqly.duckdns.org/monitor",
  );
  const [monitorToken, setMonitorToken] = useState(initial.monitorToken);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-lg shadow-primary/30">
              R
            </div>
            <h1 className="text-xl font-semibold">reqly-admin</h1>
            <p className="text-muted-foreground text-sm">
              Console d&apos;administration — accès opérateur
            </p>
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onConnect({
                syncBase: syncBase.trim(),
                syncToken: syncToken.trim(),
                monitorBase: monitorBase.trim(),
                monitorToken: monitorToken.trim(),
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="sync-base" className="flex items-center gap-1.5">
                <Globe className="size-3.5" /> Sync-server (API admin)
              </Label>
              <Input
                id="sync-base"
                type="url"
                required
                placeholder="https://reqly.duckdns.org"
                value={syncBase}
                onChange={(e) => setSyncBase(e.target.value)}
              />
              <Input
                type="password"
                required
                placeholder="ADMIN_TOKEN (sync-server)"
                value={syncToken}
                onChange={(e) => setSyncToken(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mon-base" className="text-muted-foreground text-xs">
                Monitoring (optionnel)
              </Label>
              <Input
                id="mon-base"
                type="url"
                placeholder="https://reqly.duckdns.org/monitor"
                value={monitorBase}
                onChange={(e) => setMonitorBase(e.target.value)}
              />
              <Input
                type="password"
                placeholder="ADMIN_TOKEN (monitor)"
                value={monitorToken}
                onChange={(e) => setMonitorToken(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full gap-2">
              <KeyRound className="size-4" /> Se connecter
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
