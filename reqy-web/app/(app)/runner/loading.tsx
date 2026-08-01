/**
 * Loading UI shown while the Runner page is being prepared.
 * Mirrors the report list + details layout.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex h-full w-full flex-col p-6 gap-4"
      role="status"
      aria-label="Loading runner"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-6 opacity-60" />
        <Skeleton className="h-7 w-48" />
      </div>

      {/* Two-pane area */}
      <div className="flex flex-1 gap-4">
        {/* Left: collection list */}
        <div className="w-72 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-12 w-full opacity-60" />
          <Skeleton className="h-12 w-full opacity-40" />
        </div>

        {/* Right: report details */}
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-32 w-full rounded-lg opacity-60" />
          <Skeleton className="h-32 w-full rounded-lg opacity-40" />
        </div>
      </div>
    </div>
  );
}
