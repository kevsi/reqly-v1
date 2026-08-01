import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Severity } from "@/src/ai/types";

const SEVERITY_STYLES: Record<Severity, string> = {
  error: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400 dark:border-blue-500/20",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  error: "ERREUR",
  warning: "ATTENTION",
  info: "INFO",
};

export function DiagBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px] font-semibold uppercase tracking-wider",
        SEVERITY_STYLES[severity],
      )}
    >
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}
