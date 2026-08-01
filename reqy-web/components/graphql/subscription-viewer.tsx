"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SubscriptionMessageView {
  id: number;
  type: "data" | "error" | "complete" | "info";
  payload: unknown;
  timestamp: number;
}

interface Props {
  messages: SubscriptionMessageView[];
  onStop: () => void;
}

export function SubscriptionViewer({ messages, onStop }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="border-t bg-card" data-testid="graphql-subscription-viewer">
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-xs font-medium">Live Subscription ({messages.length} messages)</span>
        <Button
          size="sm"
          variant="destructive"
          onClick={onStop}
          data-testid="graphql-subscription-stop"
        >
          <Square className="w-3 h-3 mr-1" /> Stop
        </Button>
      </div>
      <div className="overflow-auto max-h-96 p-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground p-2">Waiting for messages...</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "p-2 rounded text-xs font-mono",
              m.type === "error"
                ? "bg-destructive/10 text-destructive"
                : m.type === "complete"
                  ? "bg-warning/10"
                  : "bg-muted/30",
            )}
          >
            <div className="text-xs text-muted-foreground mb-1">
              {new Date(m.timestamp).toLocaleTimeString()} — {m.type}
            </div>
            <pre className="whitespace-pre-wrap break-all">
              {JSON.stringify(m.payload, null, 2)}
            </pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
