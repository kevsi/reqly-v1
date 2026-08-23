"use client";

import { useMemo, useCallback } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { useTheme } from "@/components/theme-provider";

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

interface ScriptCodeMirrorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: string;
}

function ScriptCodeMirror({
  value,
  onChange,
  placeholder,
  ariaLabel,
  minHeight = "132px",
}: ScriptCodeMirrorProps) {
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
      ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
    ],
    [ariaLabel],
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

export default ScriptCodeMirror;
