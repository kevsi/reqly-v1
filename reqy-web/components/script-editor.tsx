"use client";

import { useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { useTheme } from "@/components/theme-provider";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror").then((m) => m.default), {
  ssr: false,
  loading: () => null,
});

interface Props {
  preRequestScript?: string;
  postResponseScript?: string;
  onPreChange: (next: string) => void;
  onPostChange: (next: string) => void;
}

// ── pm.* API completions ──────────────────────────────────────────────────────

const PM_COMPLETIONS = [
  // Namespaces (shown when typing `pm.`)
  { label: "pm.environment", type: "namespace" as const, detail: "pm" },
  { label: "pm.variables", type: "namespace" as const, detail: "pm" },
  { label: "pm.response", type: "namespace" as const, detail: "pm" },

  // pm.environment.*
  {
    label: "pm.environment.get()",
    type: "function" as const,
    detail: "environment",
    apply: 'pm.environment.get("")',
  },
  {
    label: "pm.environment.set()",
    type: "function" as const,
    detail: "environment",
    apply: 'pm.environment.set("", "")',
  },
  {
    label: "pm.environment.unset()",
    type: "function" as const,
    detail: "environment",
    apply: 'pm.environment.unset("")',
  },

  // pm.variables.*
  {
    label: "pm.variables.get()",
    type: "function" as const,
    detail: "variables",
    apply: 'pm.variables.get("")',
  },
  {
    label: "pm.variables.set()",
    type: "function" as const,
    detail: "variables",
    apply: 'pm.variables.set("", "")',
  },
  {
    label: "pm.variables.unset()",
    type: "function" as const,
    detail: "variables",
    apply: 'pm.variables.unset("")',
  },

  // pm.response.*
  { label: "pm.response.code", type: "property" as const, detail: "response" },
  {
    label: "pm.response.text()",
    type: "function" as const,
    detail: "response",
    apply: "pm.response.text()",
  },
  {
    label: "pm.response.json()",
    type: "function" as const,
    detail: "response",
    apply: "pm.response.json()",
  },
  { label: "pm.response.headers", type: "property" as const, detail: "response" },
  { label: "pm.response.responseTime", type: "property" as const, detail: "response" },

  // pm.expect
  { label: "pm.expect()", type: "function" as const, detail: "pm", apply: "pm.expect()" },
  {
    label: "pm.expect().to.equal()",
    type: "function" as const,
    detail: "pm.expect",
    apply: "pm.expect().to.equal()",
  },
  {
    label: "pm.expect().to.include()",
    type: "function" as const,
    detail: "pm.expect",
    apply: "pm.expect().to.include()",
  },
  {
    label: "pm.expect(pm.response.code).to.equal()",
    type: "function" as const,
    detail: "pm.expect",
    apply: "pm.expect(pm.response.code).to.equal()",
  },
  {
    label: "pm.expect(pm.response.text()).to.include()",
    type: "function" as const,
    detail: "pm.expect",
    apply: 'pm.expect(pm.response.text()).to.include("")',
  },

  // pm.test
  {
    label: "pm.test()",
    type: "function" as const,
    detail: "pm",
    apply: 'pm.test("", () => {})',
  },
];

function pmCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const input = word.text.toLowerCase();
  const options = PM_COMPLETIONS.filter((c) => c.label.toLowerCase().includes(input)).map(
    ({ apply, ...rest }) => ({
      ...rest,
      apply: apply ? () => apply : undefined,
    }),
  );

  return { from: word.from, options };
}

// ── Editor component ──────────────────────────────────────────────────────────

function ScriptCodeMirror({
  value,
  onChange,
  placeholder,
  minHeight = "132px",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: string;
}) {
  const { theme: appTheme } = useTheme();
  const cmTheme = appTheme === "dark" || appTheme === "midnight" ? "dark" : "light";

  const extensions = useMemo(
    () => [
      javascript(),
      autocompletion({
        activateOnTyping: true,
        maxRenderedOptions: 50,
        override: [pmCompletionSource],
      }),
      EditorView.theme({
        "&": { fontSize: "13px", fontFamily: "var(--font-mono, monospace)" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ],
    [],
  );

  const handleChange = useCallback(
    (v: string) => {
      onChange(v);
    },
    [onChange],
  );

  return (
    <div style={{ minHeight }} className="border rounded overflow-hidden bg-muted/10">
      <CodeMirror
        value={value}
        height={minHeight}
        extensions={extensions}
        onChange={handleChange}
        theme={cmTheme}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          autocompletion: true,
          highlightActiveLine: false,
          bracketMatching: true,
          closeBrackets: true,
        }}
        className="text-sm"
      />
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export function ScriptEditor({
  preRequestScript,
  postResponseScript,
  onPreChange,
  onPostChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Pre-request script (JS, sandboxed)
        </label>
        <ScriptCodeMirror
          value={preRequestScript ?? ""}
          onChange={onPreChange}
          placeholder="// pm.environment.set('token', 'abc123')"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Post-response script (JS, sandboxed)
        </label>
        <ScriptCodeMirror
          value={postResponseScript ?? ""}
          onChange={onPostChange}
          placeholder="// pm.expect(pm.response.code).to.equal(200)"
        />
      </div>
    </div>
  );
}
