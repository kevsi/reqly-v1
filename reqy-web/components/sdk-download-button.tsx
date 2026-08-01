"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Code2, Loader2 } from "lucide-react";
import { generateOpenApiSpec } from "@/lib/openapi-export";
import { generateSdk } from "@/lib/openapi-gen/generator";
import type { Collection } from "@/hooks/use-request-store";

interface HistoryLikeItem {
  requestId: string;
  responseBody?: unknown;
}

interface Props {
  collections: Collection[];
  historyItems?: HistoryLikeItem[];
  inferFromHistory?: boolean;
  defaultName?: string;
}

export function SdkDownloadButton({
  collections,
  historyItems,
  inferFromHistory = false,
  defaultName = "reqly",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setLoading(true);
    setError(null);
    try {
      const mappedHistory = inferFromHistory
        ? historyItems?.map((h) => ({
            requestId: h.requestId,
            responseBody: h.responseBody,
          }))
        : undefined;
      const spec = generateOpenApiSpec(collections, {
        enableInference: inferFromHistory && !!mappedHistory,
        historyItems: mappedHistory,
      });
      const result = await generateSdk(spec, "typescript-fetch", defaultName);

      if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
        try {
          const handle = await (
            window as unknown as {
              showSaveFilePicker: (opts: {
                suggestedName?: string;
                types?: Array<{
                  description: string;
                  accept: Record<string, string[]>;
                }>;
              }) => Promise<{
                createWritable: () => Promise<{
                  write: (chunk: BufferSource | Blob) => Promise<void>;
                  close: () => Promise<void>;
                }>;
              }>;
            }
          ).showSaveFilePicker({
            suggestedName: result.filename,
            types: [
              {
                description: "ZIP archive",
                accept: { "application/zip": [".zip"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(result.blob);
          await writable.close();
          return;
        } catch {
          // User cancelled
          return;
        }
      }

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SDK generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={download}
        disabled={loading || collections.length === 0}
        data-testid="sdk-download-button"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
        ) : (
          <Code2 className="w-3 h-3 mr-1" />
        )}
        {loading ? "Generating..." : "Download TypeScript SDK"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Generates a TypeScript client via OpenAPI Generator (ZIP).
      </p>
    </div>
  );
}
