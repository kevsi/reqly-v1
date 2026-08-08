"use client";

import { useMemo, useCallback } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { graphql } from "cm6-graphql";
import { autocompletion } from "@codemirror/autocomplete";
import { buildClientSchema, type GraphQLSchema } from "graphql";
import { useTheme } from "@/components/theme-provider";

/**
 * Convert an introspection result (raw JSON from `__schema`) to a
 * GraphQLSchema instance consumable by cm6-graphql.
 *
 * The introspection shape returned by `lib/graphql/introspect.ts` is
 * `{ data: { __schema: ... } }` — we unwrap to the schema object.
 */
function toGraphQLSchema(schema: unknown): GraphQLSchema | undefined {
  if (!schema) return undefined;
  try {
    // Already a GraphQLSchema instance
    if (typeof (schema as { getQueryType?: unknown }).getQueryType === "function") {
      return schema as GraphQLSchema;
    }
    // Introspection result wrapper
    const introspection = (schema as { data?: unknown }).data ?? schema;
    return buildClientSchema(introspection as Parameters<typeof buildClientSchema>[0]);
  } catch {
    return undefined;
  }
}

interface GraphqlQueryEditorBodyProps {
  value: string;
  onChange: (v: string) => void;
  schema?: unknown;
  placeholder?: string;
  readOnly?: boolean;
}

function GraphqlQueryEditorBody({
  value,
  onChange,
  schema,
  placeholder,
  readOnly,
}: GraphqlQueryEditorBodyProps) {
  const { theme: appTheme } = useTheme();
  const cmTheme = appTheme === "dark" || appTheme === "midnight" ? "dark" : "light";

  const extensions = useMemo(() => {
    const gqlSchema = toGraphQLSchema(schema);
    const baseExtensions = gqlSchema
      ? graphql(gqlSchema, {
          // Show an indicator when schema is invalid
          showErrorOnInvalidSchema: true,
        })
      : graphql();

    return [
      ...baseExtensions,
      // CodeMirror 6 autocompletion is what actually drives the suggestion popup.
      // cm6-graphql registers a completion source via `completion`, but without
      // the `autocompletion()` extension here, no popup ever appears.
      autocompletion({
        activateOnTyping: true,
        maxRenderedOptions: 50,
        override: [],
      }),
      EditorView.theme({
        "&": { fontSize: "13px" },
      }),
    ];
  }, [schema]);

  const handleChange = useCallback(
    (v: string) => {
      onChange(v);
    },
    [onChange],
  );

  return (
    <div className="border-b bg-muted/10" data-testid="graphql-query-editor">
      <CodeMirror
        value={value}
        height="300px"
        extensions={extensions}
        onChange={handleChange}
        theme={cmTheme}
        placeholder={
          placeholder ?? "# Write your GraphQL query here\nquery GetUsers {\n  users { id name }\n}"
        }
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          // Force autocompletion in basicSetup too, so the trigger shortcut (Ctrl-Space)
          // works even if our explicit extension above is overridden.
          autocompletion: true,
          highlightActiveLine: !readOnly,
        }}
        className="text-sm"
      />
    </div>
  );
}

export default GraphqlQueryEditorBody;
