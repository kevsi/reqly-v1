"use client";
import { Cloud, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ModeIndicator({ mode }: { mode: "local" | "cloud" }) {
  const isLocal = mode === "local";
  return (
    <Badge
      variant="outline"
      data-testid="reqlyai-mode-indicator"
      data-mode={mode}
      className={cn(
        "gap-1 rounded-full text-[10px]",
        isLocal
          ? "border-success/30 bg-success/10 text-success"
          : "border-violet-500/30 bg-violet-500/10 text-violet-600",
      )}
    >
      {isLocal ? <Cpu className="size-3" /> : <Cloud className="size-3" />}
      {isLocal ? "Local" : "Cloud"}
    </Badge>
  );
}
