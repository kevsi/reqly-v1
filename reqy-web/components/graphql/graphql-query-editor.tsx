"use client";

import dynamic from "next/dynamic";

// The whole editor stack (CodeMirror core, cm6-graphql, the `graphql` lib used
// for buildClientSchema) lives in graphql-query-editor-body and is only fetched
// when the GraphQL tab is rendered.
const GraphqlQueryEditorBody = dynamic(() => import("./graphql-query-editor-body"), {
  ssr: false,
  loading: () => null,
});

interface Props {
  value: string;
  onChange: (v: string) => void;
  schema?: unknown;
  placeholder?: string;
  readOnly?: boolean;
}

export function GraphqlQueryEditor({ value, onChange, schema, placeholder, readOnly }: Props) {
  return (
    <GraphqlQueryEditorBody
      value={value}
      onChange={onChange}
      schema={schema}
      placeholder={placeholder}
      readOnly={readOnly}
    />
  );
}

// Re-export CompletionContext type for downstream consumers (e.g. unit tests).
// Type-only re-export — erased at compile time, zero runtime cost.
export type { CompletionContext } from "@codemirror/autocomplete";
