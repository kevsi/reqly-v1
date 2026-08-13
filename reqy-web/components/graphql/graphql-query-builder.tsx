"use client";

import { useCallback, useState } from "react";
import { Plus, ChevronRight, ChevronDown, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildQueryFromSelections, type SelectionNode } from "@/lib/graphql/query-builder";
import { typeLabel, type SchemaFieldType } from "@/lib/graphql/format";
import { useTranslation } from "react-i18next";

interface SchemaField {
  name: string;
  description?: string;
  type: SchemaFieldType;
  args?: Array<{ name: string; type: SchemaFieldType; defaultValue?: unknown }>;
}

interface SchemaType {
  name?: string;
  kind: string;
  description?: string;
  fields?: SchemaField[];
  enumValues?: Array<{ name: string }>;
}

interface SchemaData {
  queryType?: { name?: string };
  mutationType?: { name?: string };
  subscriptionType?: { name?: string };
  types?: SchemaType[];
}

export type { SchemaData, SchemaField, SchemaType };

export type OperationType = "query" | "mutation" | "subscription";

interface Props {
  schema: SchemaData | null;
  operationType: OperationType;
  onOperationTypeChange: (t: OperationType) => void;
  onQueryChange: (query: string) => void;
  operationName?: string;
}

type TreeSelections = Record<
  string,
  {
    fields: Set<string>;
    argValues: Record<string, Record<string, string>>;
  }
>;

function unwrapType(type: SchemaFieldType | undefined): string | undefined {
  if (!type) return undefined;
  if (type.kind === "NON_NULL" && type.ofType) return unwrapType(type.ofType);
  if (type.kind === "LIST" && type.ofType) return unwrapType(type.ofType);
  return type.name ?? undefined;
}

/* typeLabel is imported from @/lib/graphql/format — see top of file. */

function isCompositeTypeName(schema: SchemaData, typeName: string | undefined): boolean {
  if (!typeName) return false;
  const t = schema.types?.find((x) => x.name === typeName);
  if (!t) return false;
  return t.kind === "OBJECT" || t.kind === "INTERFACE" || t.kind === "UNION";
}

function getType(schema: SchemaData, name: string | undefined): SchemaType | undefined {
  if (!name) return undefined;
  return schema.types?.find((t) => t.name === name);
}

function getOperationTypeName(schema: SchemaData, op: OperationType): string | undefined {
  if (op === "query") return schema.queryType?.name;
  if (op === "mutation") return schema.mutationType?.name;
  return schema.subscriptionType?.name;
}

function selectionsToNodes(
  schema: SchemaData,
  typeName: string,
  selections: TreeSelections,
): SelectionNode[] {
  const typeSel = selections[typeName];
  if (!typeSel) return [];
  const type = getType(schema, typeName);
  if (!type?.fields) return [];
  const nodes: SelectionNode[] = [];
  for (const fieldName of typeSel.fields) {
    const field = type.fields.find((f) => f.name === fieldName);
    if (!field) continue;
    const argVals = typeSel.argValues[fieldName] ?? {};
    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries(argVals)) {
      if (v.trim().length > 0) args[k] = v;
    }
    const outputTypeName = unwrapType(field.type);
    let sub: string[] | SelectionNode[] = [];
    if (outputTypeName && isCompositeTypeName(schema, outputTypeName)) {
      const childSel = selections[outputTypeName]?.fields;
      if (childSel && childSel.size > 0) {
        sub = selectionsToNodes(schema, outputTypeName, selections);
      }
    }
    nodes.push({ field: field.name, args, subfields: sub });
  }
  return nodes;
}

export function GraphqlQueryBuilder({
  schema,
  operationType,
  onOperationTypeChange,
  onQueryChange,
  operationName = "GeneratedQuery",
}: Props) {
  const { t } = useTranslation();
  const [selections, setSelections] = useState<TreeSelections>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const opTypeName = getOperationTypeName(schema ?? { types: [] }, operationType);
  const opType = getType(schema ?? { types: [] }, opTypeName);

  const toggleField = useCallback((typeName: string, fieldName: string) => {
    setSelections((prev) => {
      const next: TreeSelections = { ...prev };
      const cur = next[typeName] ?? { fields: new Set<string>(), argValues: {} };
      const fields = new Set(cur.fields);
      if (fields.has(fieldName)) {
        fields.delete(fieldName);
        const argValues = { ...cur.argValues };
        delete argValues[fieldName];
        next[typeName] = { fields, argValues };
      } else {
        fields.add(fieldName);
        next[typeName] = { fields, argValues: cur.argValues };
      }
      return next;
    });
  }, []);

  const setArgValue = useCallback(
    (typeName: string, fieldName: string, argName: string, value: string) => {
      setSelections((prev) => {
        const next: TreeSelections = { ...prev };
        const cur = next[typeName] ?? { fields: new Set<string>(), argValues: {} };
        const fieldArgs = { ...(cur.argValues[fieldName] ?? {}) };
        if (value === "") delete fieldArgs[argName];
        else fieldArgs[argName] = value;
        const argValues = { ...cur.argValues, [fieldName]: fieldArgs };
        next[typeName] = { fields: cur.fields, argValues };
        return next;
      });
    },
    [],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const generateQuery = useCallback(() => {
    if (!schema || !opTypeName) return;
    const nodes = selectionsToNodes(schema, opTypeName, selections);
    if (nodes.length === 0) return;
    const query = buildQueryFromSelections(nodes, operationType, operationName);
    onQueryChange(query);
  }, [schema, opTypeName, selections, operationType, operationName, onQueryChange]);

  const clear = useCallback(() => {
    setSelections({});
    setExpanded(new Set());
  }, []);

  if (!schema) {
    return (
      <div
        className="border-b bg-muted/10 p-3 text-sm text-muted-foreground"
        data-testid="graphql-query-builder"
      >
        No schema loaded. Click{" "}
        <span className="font-medium">{t("graphql.toolbar.refreshSchema")}</span> first.
      </div>
    );
  }

  if (!opTypeName || !opType) {
    return (
      <div
        className="border-b bg-muted/10 p-3 text-sm text-muted-foreground"
        data-testid="graphql-query-builder"
      >
        {t("graphql.builder.noRootType", { operationType })}
      </div>
    );
  }

  const hasSelections = (selections[opTypeName]?.fields.size ?? 0) > 0;

  const availableOps: Record<OperationType, string | undefined> = {
    query: schema.queryType?.name,
    mutation: schema.mutationType?.name,
    subscription: schema.subscriptionType?.name,
  };

  return (
    <div className="border-b bg-muted/10" data-testid="graphql-query-builder">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/20 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["query", "mutation", "subscription"] as OperationType[]).map((op) => {
            const opTypeNameForBtn = availableOps[op];
            const isAvailable = !!opTypeNameForBtn;
            const isActive = operationType === op;
            return (
              <Button
                key={op}
                size="sm"
                variant={isActive ? "default" : isAvailable ? "outline" : "ghost"}
                className={cn(
                  "h-7 text-xs capitalize font-medium px-3",
                  !isAvailable && "opacity-50",
                )}
                onClick={() => isAvailable && onOperationTypeChange(op)}
                disabled={!isAvailable}
                data-testid={`graphql-builder-op-${op}`}
                title={
                  isAvailable
                    ? t("graphql.builder.buildOp", { op, root: opTypeNameForBtn })
                    : t("graphql.builder.noOpRoot", { op })
                }
              >
                {op}
                {!isAvailable && <span className="ml-1 text-[10px]">—</span>}
              </Button>
            );
          })}
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={clear}
            data-testid="graphql-builder-clear"
          >
            <X className="w-3 h-3 mr-1" /> {t("graphql.builder.clear")}
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={generateQuery}
            disabled={!hasSelections}
            data-testid="graphql-builder-generate"
          >
            <Plus className="w-3 h-3 mr-1" /> {t("graphql.builder.generate")}
          </Button>
        </div>
      </div>

      {operationType === "mutation" && (
        <div className="px-3 py-1.5 text-xs bg-warning/10 text-warning border-b border-warning/20">
          {t("graphql.builder.mutationWarning")}
        </div>
      )}
      {operationType === "subscription" && (
        <div className="px-3 py-1.5 text-xs bg-primary/10 text-primary border-b border-primary/20">
          {t("graphql.builder.subscriptionInfo")}
        </div>
      )}

      <div className="p-3 max-h-[28rem] overflow-auto">
        <FieldTree
          schema={schema}
          typeName={opTypeName}
          selections={selections}
          expanded={expanded}
          onToggle={toggleField}
          onToggleExpand={toggleExpand}
          onSetArg={setArgValue}
        />
      </div>
    </div>
  );
}

interface FieldTreeProps {
  schema: SchemaData;
  typeName: string;
  selections: TreeSelections;
  expanded: Set<string>;
  onToggle: (typeName: string, fieldName: string) => void;
  onToggleExpand: (key: string) => void;
  onSetArg: (typeName: string, fieldName: string, argName: string, value: string) => void;
}

function FieldTree({
  schema,
  typeName,
  selections,
  expanded,
  onToggle,
  onToggleExpand,
  onSetArg,
}: FieldTreeProps) {
  const { t } = useTranslation();
  const type = getType(schema, typeName);
  if (!type?.fields) {
    return (
      <div className="text-sm text-muted-foreground px-1 py-2">{t("graphql.builder.noFields")}</div>
    );
  }
  return (
    <div className="space-y-1">
      {type.fields.map((field) => (
        <FieldRow
          key={`${typeName}.${field.name}`}
          schema={schema}
          parentTypeName={typeName}
          field={field}
          selections={selections}
          expanded={expanded}
          onToggle={onToggle}
          onToggleExpand={onToggleExpand}
          onSetArg={onSetArg}
          depth={0}
        />
      ))}
    </div>
  );
}

function FieldRow({
  schema,
  parentTypeName,
  field,
  selections,
  expanded,
  onToggle,
  onToggleExpand,
  onSetArg,
  depth,
}: {
  schema: SchemaData;
  parentTypeName: string;
  field: SchemaField;
  selections: TreeSelections;
  expanded: Set<string>;
  onToggle: (typeName: string, fieldName: string) => void;
  onToggleExpand: (key: string) => void;
  onSetArg: (typeName: string, fieldName: string, argName: string, value: string) => void;
  depth: number;
}): React.ReactNode {
  const { t } = useTranslation();
  const expandKey = `${parentTypeName}.${field.name}`;
  const isExpanded = expanded.has(expandKey);
  const isSelected = selections[parentTypeName]?.fields.has(field.name) ?? false;
  const outputTypeName = unwrapType(field.type);
  const isComposite = isCompositeTypeName(schema, outputTypeName);
  const argValues = selections[parentTypeName]?.argValues[field.name] ?? {};

  const showSubtree = isComposite && isSelected && isExpanded;
  const subType = getType(schema, outputTypeName);
  const subFields = subType?.fields ?? [];
  const subSelectedCount = selections[outputTypeName ?? ""]?.fields.size ?? 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/40 transition-colors text-sm",
          isSelected && "bg-primary/5",
        )}
        style={{ marginLeft: depth * 16 }}
      >
        {isComposite ? (
          <button
            type="button"
            onClick={() => onToggleExpand(expandKey)}
            className="text-muted-foreground hover:text-foreground w-4 h-4 inline-flex items-center justify-center shrink-0"
            data-testid={`graphql-builder-expand-${field.name}`}
            aria-label={isExpanded ? t("graphql.builder.collapse") : t("graphql.builder.expand")}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-4 h-4 inline-block shrink-0" />
        )}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(parentTypeName, field.name)}
          className="w-3.5 h-3.5 shrink-0 cursor-pointer"
          data-testid={`graphql-builder-field-${field.name}`}
        />
        <span className="font-mono font-medium">{field.name}</span>
        <span className="text-xs text-muted-foreground font-mono">{typeLabel(field.type)}</span>
        {field.args && field.args.length > 0 && (
          <span className="text-xs text-muted-foreground italic shrink-0">
            ({field.args.length} {t("graphql.builder.args", { count: field.args.length })})
          </span>
        )}
        {field.description && (
          <span title={field.description} className="text-muted-foreground/60 shrink-0">
            <Info className="w-3.5 h-3.5" />
          </span>
        )}
        {isComposite && subSelectedCount > 0 && (
          <span className="text-xs text-success ml-auto shrink-0">
            ({subSelectedCount} {t("graphql.builder.selected", { count: subSelectedCount })})
          </span>
        )}
      </div>

      {/* Arg inputs */}
      {isSelected && field.args && field.args.length > 0 && (
        <div className="mt-1 mb-2 space-y-1" style={{ marginLeft: depth * 16 + 32 }}>
          {field.args.map((arg) => (
            <label key={arg.name} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-mono w-24 shrink-0 truncate">
                {arg.name}:
              </span>
              <input
                value={argValues[arg.name] ?? ""}
                onChange={(e) => onSetArg(parentTypeName, field.name, arg.name, e.target.value)}
                placeholder={arg.type.name ?? typeLabel(arg.type)}
                className="flex-1 px-2 py-1 text-xs font-mono border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid={`graphql-builder-arg-${field.name}-${arg.name}`}
              />
            </label>
          ))}
        </div>
      )}

      {/* Recursive subtree */}
      {showSubtree && subFields.length > 0 && outputTypeName && (
        <div
          className="border-l-2 border-primary/20 ml-3 pl-2 mt-1"
          style={{ marginLeft: depth * 16 + 24 }}
        >
          {subFields.map((subField) => (
            <FieldRow
              key={`${outputTypeName}.${subField.name}`}
              schema={schema}
              parentTypeName={outputTypeName}
              field={subField}
              selections={selections}
              expanded={expanded}
              onToggle={onToggle}
              onToggleExpand={onToggleExpand}
              onSetArg={onSetArg}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
