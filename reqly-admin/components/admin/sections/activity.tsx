"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { syncApi, type ActivityEntry } from "@/lib/api";
import type { AdminConfig } from "@/lib/config";
import { fmtDateTime, fmtAgo } from "@/lib/utils";

const ACTION_COLORS: Record<string, string> = {
  created: "bg-primary/10 text-primary",
  updated: "bg-chart-2/10 text-chart-2",
  deleted: "bg-destructive/10 text-destructive",
  joined: "bg-chart-4/10 text-chart-4",
};

export function ActivitySection({ config }: { config: AdminConfig }) {
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    syncApi(config)
      .activity(100)
      .then((r) => setActivity(r.activity))
      .catch(() => setActivity([]));
  }, [config]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Journal d&apos;activité</h2>
      <Card>
        <CardContent className="space-y-1 pt-6">
          {!activity &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          {activity?.map((a) => {
            const tone =
              Object.entries(ACTION_COLORS).find(([k]) => a.action.includes(k))?.[1] ??
              "bg-secondary text-secondary-foreground";
            return (
              <div
                key={a.id}
                className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`metric-mono shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tone}`}
                  >
                    {a.action}
                  </span>
                  <span className="truncate text-sm">
                    {a.actorEmail ?? "?"}
                    {a.workspaceName && (
                      <span className="text-muted-foreground"> · {a.workspaceName}</span>
                    )}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-muted-foreground text-[11px]">{fmtAgo(a.createdAt)}</p>
                  <p className="text-muted-foreground metric-mono text-[10px]">
                    {fmtDateTime(a.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
          {activity?.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Aucune activité enregistrée
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
