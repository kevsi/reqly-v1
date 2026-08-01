/**
 * Loading UI for route transitions.
 *
 * Shows a subtle skeleton inside the existing layout (sidebar + header stay
 * visible).  The skeleton mirrors the content area structure so users don't
 * perceive a layout shift when the real content arrives.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden" role="status" aria-label="Loading">
      {/* ── Mock header bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32 ml-auto" />
        <Skeleton className="h-8 w-8" />
      </div>

      {/* ── Tab bar placeholder ── */}
      <div className="flex items-center gap-1 px-4 pt-2 pb-1 border-b border-border/40">
        <Skeleton className="h-8 w-40 rounded-t-md rounded-b-none" />
        <Skeleton className="h-8 w-32 rounded-t-md rounded-b-none opacity-50" />
        <Skeleton className="h-8 w-8 ml-auto opacity-40" />
      </div>

      {/* ── URL bar ── */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* ── Split panels ── */}
      <div className="flex flex-1 gap-0.5 px-4 pb-4">
        {/* Request panel */}
        <div className="flex-1 flex flex-col gap-3 p-3 rounded-lg border border-border/20">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="flex-1 opacity-60" />
          <Skeleton className="h-10 w-full opacity-40" />
        </div>

        {/* Divider */}
        <div className="w-px bg-border/20 mx-1" />

        {/* Response panel */}
        <div className="flex-1 flex flex-col gap-3 p-3 rounded-lg border border-border/20">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-16 opacity-50" />
          </div>
          <Skeleton className="flex-1 opacity-40" />
        </div>
      </div>
    </div>
  );
}
