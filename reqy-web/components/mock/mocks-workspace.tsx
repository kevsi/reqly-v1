"use client";

import type { Ref } from "react";
import { ChevronUp } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const K = {
  showLogs: "mocks.layout.showLogs",
} as const;

interface MocksWorkspaceProps {
  isMobile: boolean;
  routeList: React.ReactNode;
  editorPane: React.ReactNode;
  logsPane: React.ReactNode;
  leftPanelRef: Ref<ImperativePanelHandle>;
  logsPanelRef: Ref<ImperativePanelHandle>;
  logsCollapsed: boolean;
  onToggleLogsCollapsed: () => void;
  onLogsCollapse: () => void;
  onLogsExpand: () => void;
  onInnerLayout: (sizes: number[]) => void;
  onOuterLayout: (sizes: number[]) => void;
}

/** Desktop resizable split (routes|editor over logs) or stacked mobile fallback. */
export function MocksWorkspace({
  isMobile,
  routeList,
  editorPane,
  logsPane,
  leftPanelRef,
  logsPanelRef,
  logsCollapsed,
  onToggleLogsCollapsed,
  onLogsCollapse,
  onLogsExpand,
  onInnerLayout,
  onOuterLayout,
}: MocksWorkspaceProps) {
  const { t } = useTranslation();

  if (isMobile) {
    return (
      <div className="scrollbar-discreet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="max-h-[45vh] shrink-0 overflow-hidden">{routeList}</div>
        <div className="min-h-[420px] flex-1">{editorPane}</div>
        <div className="h-[40vh] shrink-0">{logsPane}</div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      direction="vertical"
      className="min-h-0 flex-1 px-4 pb-3 pt-3"
      onLayout={onOuterLayout}
    >
      <ResizablePanel defaultSize={72} minSize={25}>
        <ResizablePanelGroup direction="horizontal" className="h-full" onLayout={onInnerLayout}>
          <ResizablePanel
            ref={leftPanelRef}
            defaultSize={30}
            minSize={22}
            maxSize={50}
            className="min-w-0"
          >
            {routeList}
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5" />
          <ResizablePanel className="min-w-0">{editorPane}</ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle
        withHandle={!logsCollapsed}
        disabled={logsCollapsed}
        className={cn(
          "my-1.5",
          logsCollapsed &&
            "bg-transparent data-[panel-group-direction=vertical]:h-auto data-[panel-group-direction=vertical]:min-h-6 data-[panel-group-direction=vertical]:after:hidden",
        )}
      >
        {logsCollapsed && (
          <button
            type="button"
            onClick={onToggleLogsCollapsed}
            className="hover:text-foreground focus-visible:ring-ring flex items-center gap-1 rounded-md border bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={t(K.showLogs, { defaultValue: "Afficher les logs" })}
            title={t(K.showLogs, { defaultValue: "Afficher les logs" })}
          >
            <ChevronUp aria-hidden="true" className="size-3" />
            Logs
          </button>
        )}
      </ResizableHandle>

      <ResizablePanel
        ref={logsPanelRef}
        defaultSize={28}
        minSize={14}
        maxSize={60}
        collapsible
        collapsedSize={0}
        className="overflow-hidden"
        onCollapse={onLogsCollapse}
        onExpand={onLogsExpand}
      >
        {logsPane}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
