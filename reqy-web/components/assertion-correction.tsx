"use client";

import { useState } from "react";
import { Sparkles, Check, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  proposeAssertionCorrection,
  type CorrectionAssertionInput,
  type CorrectionSuggestion,
} from "@/src/ai/cloud-engine/actions/propose-correction";
import type { TestResult } from "@/lib/types";

interface AssertionCorrectionProps {
  result: TestResult;
  endpoint: string;
  responseStatus?: number;
  responseBody?: string;
  askAI: (prompt: string) => Promise<string>;
  onApply: (result: TestResult, suggestion: CorrectionSuggestion) => void;
}

/** Human-readable rendering of an assertion shape for the actuelle/proposée diff. */
function displayAssertion(input: Partial<CorrectionAssertionInput>): string {
  if (input.expr) return input.expr;
  if (input.type === "status") return `status == ${String(input.value)}`;
  if (input.type === "responseTime") return `response time ${String(input.value)}`;
  if (input.type === "jsonPath") {
    return `${input.target ?? ""} ${input.operator ?? ""} ${
      input.value !== undefined ? String(input.value) : ""
    }`.trim();
  }
  return [
    input.type,
    input.target,
    input.operator,
    input.value !== undefined ? String(input.value) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * "Proposer une correction" flow for a single failed assertion.
 *
 * On click it asks the AI engine for a corrected assertion, shows the
 * actuelle ↔ proposée diff, and only applies it when the user explicitly
 * clicks "Appliquer". Nothing is ever applied automatically — this respects
 * the existing `store.aiAutoApply` default-off guard (no bypass).
 */
export function AssertionCorrection({
  result,
  endpoint,
  responseStatus,
  responseBody,
  askAI,
  onApply,
}: AssertionCorrectionProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<CorrectionSuggestion | null>(null);
  const [rationale, setRationale] = useState<string>("");

  const current: CorrectionAssertionInput = {
    type: result.type,
    target: result.target,
    value: result.expected,
  };

  const handlePropose = async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await proposeAssertionCorrection(
        {
          assertion: current,
          response: { status: responseStatus, body: responseBody },
          endpoint,
        },
        askAI,
      );
      setSuggestion(out.suggestion);
      setRationale(out.rationale);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setSuggestion(null);
    setRationale("");
    setError(null);
  };

  return (
    <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 space-y-2">
      {!suggestion && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs"
          onClick={handlePropose}
          disabled={loading}
          data-testid="propose-correction"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {t("assertion.propose")}
        </Button>
      )}

      {error && <div className="text-[11px] text-destructive">{error}</div>}

      {suggestion && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            {t("assertion.current")} <code className="font-mono">{displayAssertion(current)}</code>
          </div>
          <div className="text-[11px] text-success">
            {t("assertion.proposed")}{" "}
            <code className="font-mono">{displayAssertion(suggestion)}</code>
          </div>
          {rationale && <div className="text-[11px] text-muted-foreground">{rationale}</div>}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-6 text-xs"
              onClick={() => onApply(result, suggestion)}
              data-testid="apply-correction"
            >
              <Check className="size-3" />
              {t("common.apply")}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={reset}>
              <X className="size-3" />
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
