"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { runTransformLocal } from "./local-engine";

const K = {
  test: "mocks.behavior.transform.test",
  result: "mocks.behavior.transform.result",
  error: "mocks.behavior.transform.error",
  copyResult: "mocks.behavior.transform.copyResult",
  copiedResult: "mocks.behavior.transform.copiedResult",
} as const;

interface TransformTesterProps {
  code: string;
  method: string;
  path: string;
  sampleBody: unknown;
}

export function TransformTester({ code, method, path, sampleBody }: TransformTesterProps) {
  const { t } = useTranslation();
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  function run() {
    setRunning(true);
    setError(null);
    setOutput(null);
    try {
      const result = runTransformLocal(code, {
        request: { method, path, query: { id: "42" }, headers: {} },
        body: sampleBody,
        state: {},
      });
      setOutput(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function copyResult() {
    if (output === null) return;
    navigator.clipboard
      .writeText(output)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // clipboard unavailable (permissions/insecure context) — ignore
      });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-fit text-xs"
          onClick={run}
          disabled={running || !code}
        >
          <Play aria-hidden="true" className="size-3" />
          {t(K.test, { defaultValue: "Tester" })}
        </Button>
      </div>
      {(output !== null || error !== null) && (
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {error
                ? t(K.error, { defaultValue: "Erreur" })
                : t(K.result, { defaultValue: "Résultat" })}
            </p>
            {!error && output !== null && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={copyResult}
                aria-label={t(K.copyResult, { defaultValue: "Copier le résultat" })}
                title={
                  copied
                    ? t(K.copiedResult, { defaultValue: "Copié" })
                    : t(K.copyResult, { defaultValue: "Copier le résultat" })
                }
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-3 text-emerald-600" />
                ) : (
                  <Copy aria-hidden="true" className="size-3" />
                )}
              </Button>
            )}
          </div>
          <pre
            className={cn(
              "max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap",
              error && "text-destructive",
            )}
          >
            {error ?? output}
            {running && <Loader2 aria-hidden="true" className="ml-1 inline size-3 animate-spin" />}
          </pre>
        </div>
      )}
    </div>
  );
}
