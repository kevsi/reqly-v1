/**
 * Loading UI shown while the Collections page is being prepared.
 * Mirrors the two-pane layout (sidebar list + main panel) so the transition
 * to the real content feels seamless.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-full w-full" role="status" aria-label="Loading collections">
      {/* Left: collection/folder tree */}
      <div className="w-72 border-r border-border p-3 space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-3/4 opacity-60" />
        <Skeleton className="h-6 w-2/3 opacity-60" />
        <Skeleton className="h-6 w-4/5 opacity-60" />
        <Skeleton className="h-6 w-1/2 opacity-40" />
      </div>

      {/* Right: main panel */}
      <div className="flex-1 p-6 space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64 opacity-60" />
        <Skeleton className="flex-1 rounded-lg opacity-40 mt-4" />
      </div>
    </div>
  );
}
