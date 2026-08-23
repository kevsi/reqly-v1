"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { syncApi, type AdminWorkspace } from "@/lib/api";
import type { AdminConfig } from "@/lib/config";
import { fmtDate } from "@/lib/utils";

export function WorkspacesSection({ config }: { config: AdminConfig }) {
  const [ws, setWs] = useState<AdminWorkspace[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    syncApi(config)
      .workspaces(100)
      .then((r) => {
        setWs(r.workspaces);
        setTotal(r.total);
      })
      .catch(() => setWs([]));
  }, [config]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        Workspaces <span className="text-muted-foreground text-sm font-normal">({total})</span>
      </h2>
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!ws &&
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[110px]" />)}
            {ws?.map((w) => (
              <Card key={w.id} className="gap-2 py-4">
                <CardHeader className="pb-0">
                  <CardTitle className="flex items-center justify-between text-sm font-medium">
                    <span className="truncate">{w.name}</span>
                    <Badge variant="secondary">
                      {w.memberCount} membre{w.memberCount > 1 ? "s" : ""}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <p className="text-muted-foreground truncate">{w.ownerEmail ?? "—"}</p>
                  <p className="text-muted-foreground">
                    {w.collectionCount} collection{w.collectionCount > 1 ? "s" : ""} · créé{" "}
                    {fmtDate(w.createdAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          {ws?.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-sm">Aucun workspace</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
