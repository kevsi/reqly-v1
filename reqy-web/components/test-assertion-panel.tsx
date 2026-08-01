"use client";

import { Plus, Play, Trash2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { RequestTestAssertion, AssertionType } from "@/lib/types";

const assertionTypeLabels: Record<AssertionType, string> = {
  status: "Status Code",
  bodyContains: "Body Contains",
  headerExists: "Header Exists",
  jsonPath: "JSON Path",
};

interface TestAssertionPanelProps {
  assertions: RequestTestAssertion[];
  onChange: (assertions: RequestTestAssertion[]) => void;
  onRunTests?: () => void;
}

export function TestAssertionPanel({ assertions, onChange, onRunTests }: TestAssertionPanelProps) {
  const addAssertion = () => {
    const newAssertion: RequestTestAssertion = {
      id: `assert-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: "status",
      target: "200",
      expected: "",
      enabled: true,
    };
    onChange([...assertions, newAssertion]);
  };

  const removeAssertion = (index: number) => {
    onChange(assertions.filter((_, i) => i !== index));
  };

  const updateAssertion = (index: number, patch: Partial<RequestTestAssertion>) => {
    onChange(assertions.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  return (
    <div className="space-y-3">
      {assertions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 text-xs text-muted-foreground/60">
          <FlaskConical className="size-6 mb-2 text-muted-foreground/30" />
          <span>No assertions added yet</span>
        </div>
      )}
      {assertions.map((assertion, index) => (
        <div
          key={assertion.id}
          className="group/assertion flex items-start gap-2 rounded-lg border border-border bg-muted/10 p-2.5 transition-all duration-200 hover:bg-muted/20"
        >
          <div className="flex flex-1 flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={assertion.type}
                onValueChange={(value) => updateAssertion(index, { type: value as AssertionType })}
              >
                <SelectTrigger className="h-8 w-36 border-input bg-muted/20 text-xs font-medium transition-all duration-200 hover:border-muted-foreground/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["status", "bodyContains", "headerExists", "jsonPath"] as AssertionType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {assertionTypeLabels[t]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Switch
                checked={assertion.enabled}
                onCheckedChange={(checked) => updateAssertion(index, { enabled: checked })}
                className="data-[state=checked]:bg-success"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="text"
                value={assertion.target}
                onChange={(e) => updateAssertion(index, { target: e.target.value })}
                placeholder={
                  assertion.type === "status"
                    ? "200 or >= 200 && < 300"
                    : assertion.type === "bodyContains"
                      ? "text to find"
                      : assertion.type === "headerExists"
                        ? "header-name"
                        : "$.data.id"
                }
                className="flex-1 h-8 border-input bg-muted/20 text-xs transition-all duration-200 focus:bg-muted/40 min-w-0"
              />
              {assertion.type !== "status" && (
                <Input
                  type="text"
                  value={assertion.expected ?? ""}
                  onChange={(e) => updateAssertion(index, { expected: e.target.value })}
                  placeholder={
                    assertion.type === "jsonPath" ? "expected value" : "expected value (optional)"
                  }
                  className="flex-1 h-8 border-input bg-muted/20 text-xs transition-all duration-200 focus:bg-muted/40 min-w-0"
                />
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeAssertion(index)}
            className="shrink-0 size-7 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover/assertion:opacity-100 transition-all duration-200"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={addAssertion}
          className="flex-1 border-dashed border-muted-foreground/20 text-muted-foreground/70 hover:text-foreground hover:border-muted-foreground/40 transition-all duration-200 h-9 text-xs font-medium"
        >
          <Plus className="size-3.5 mr-1" />
          Add Assertion
        </Button>
        {onRunTests && (
          <Button
            variant="outline"
            onClick={onRunTests}
            className="h-9 gap-1.5 text-xs font-medium border-dashed border-muted-foreground/20 text-muted-foreground/70 hover:text-foreground hover:border-muted-foreground/40 transition-all duration-200"
          >
            <Play className="size-3.5" />
            Run Tests
          </Button>
        )}
      </div>
    </div>
  );
}
