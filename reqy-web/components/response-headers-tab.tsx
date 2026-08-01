"use client";

import { memo, useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ResponseHeadersTabProps {
  responseHeaders?: Record<string, string>;
}

export const ResponseHeadersTab = memo(function ResponseHeadersTab({
  responseHeaders,
}: ResponseHeadersTabProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const headersText = Object.entries(responseHeaders ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      await navigator.clipboard.writeText(headersText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!responseHeaders) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-4">
        <div className="rounded-full bg-muted/30 p-3 mb-3">
          <FileText className="size-6 text-muted-foreground/30" />
        </div>
        <p className="text-xs text-muted-foreground/60">
          Headers will appear after running a request
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50">
          {Object.keys(responseHeaders).length} headers
        </span>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 text-xs font-medium transition-all duration-200",
            copied && "border-success/30 text-success bg-success/10",
          )}
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="space-y-1">
        {Object.entries(responseHeaders).map(([key, value]) => (
          <div
            key={key}
            className="group/header flex items-start gap-3 rounded-lg border border-border/30 bg-muted/10 px-3.5 py-2.5 transition-all duration-200 hover:bg-muted/20 hover:border-border/60"
          >
            <span className="shrink-0 text-xs font-bold text-foreground/80">{key}:</span>
            <span className="text-xs text-muted-foreground/80 break-all leading-relaxed">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
