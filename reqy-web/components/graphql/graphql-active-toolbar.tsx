"use client";

import { Save, Play, Square, Copy, Sparkles, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GraphqlTab } from "@/lib/types";

interface Props {
  activeTab: GraphqlTab;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onRun: () => void;
  onStop: () => void;
  onExport: () => void;
  onAiAssist: () => void;
  onAiFix?: () => void;
  onLoadFromCollection?: () => void;
  running: boolean;
  aiLoading?: boolean;
  aiError?: string | null;
}

export function GraphqlActiveToolbar({
  activeTab,
  onNameChange,
  onSave,
  onRun,
  onStop,
  onExport,
  onAiAssist,
  onAiFix,
  onLoadFromCollection,
  running,
  aiLoading,
  aiError,
}: Props) {
  return (
    <div
      className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2 flex-wrap"
      data-testid="graphql-active-toolbar"
    >
      <Input
        value={activeTab.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="h-7 w-48 text-xs bg-background"
        placeholder="Request name..."
        data-testid="graphql-tab-name-input"
      />
      {activeTab.saved === false && activeTab.dirty && (
        <span className="text-[10px] text-warning font-medium">Unsaved</span>
      )}
      <div className="flex-1" />
      {onLoadFromCollection && (
        <Button size="sm" variant="ghost" onClick={onLoadFromCollection}>
          <GitBranch className="w-3 h-3 mr-1" /> Load
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onAiAssist}
        disabled={aiLoading}
        data-testid="graphql-ai-button"
      >
        <Sparkles className="w-3 h-3 mr-1" /> {aiLoading ? "Thinking…" : "AI"}
      </Button>
      {onAiFix && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onAiFix}
          disabled={aiLoading || !activeTab.response?.errors?.length}
          data-testid="graphql-ai-fix"
          title="Auto-fix query from the last server-side error"
        >
          <Sparkles className="w-3 h-3 mr-1" /> Fix
        </Button>
      )}
      {aiError && (
        <span className="text-[10px] text-destructive max-w-[160px] truncate" title={aiError}>
          {aiError}
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={onExport} data-testid="graphql-export-button">
        <Copy className="w-3 h-3 mr-1" /> Export
      </Button>
      <Button size="sm" variant="outline" onClick={onSave} data-testid="graphql-save-button">
        <Save className="w-3 h-3 mr-1" /> Save
      </Button>
      {running ? (
        <Button size="sm" variant="destructive" onClick={onStop} data-testid="graphql-stop-button">
          <Square className="w-3 h-3 mr-1" /> Stop
        </Button>
      ) : (
        <Button size="sm" onClick={onRun} data-testid="graphql-send-button">
          <Play className="w-3 h-3 mr-1" /> Send
        </Button>
      )}
    </div>
  );
}
