"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { X, Search } from "lucide-react";
interface SchemaDocPanelProps {
  schema: unknown;
  onClose: () => void;
}

export function SchemaDocPanel({ schema, onClose }: SchemaDocPanelProps) {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Schema can be either a GraphQLSchema instance (has getTypeMap) or a
  // raw introspection object (has __schema.types), or null/undefined.
  const graphqlSchema = useMemo(() => {
    if (!schema) return null;
    // Check if it's a GraphQLSchema instance
    if (typeof schema === "object" && "getTypeMap" in (schema as Record<string, unknown>)) {
      return schema as import("graphql").GraphQLSchema;
    }
    return null;
  }, [schema]);

  const typeMap = useMemo(
    () => (graphqlSchema ? graphqlSchema.getTypeMap() : null),
    [graphqlSchema],
  );

  const allTypes = useMemo(() => {
    if (!typeMap) return [];
    return Object.values(typeMap)
      .filter((t) => !t.name.startsWith("__") && !t.name.match(/^[a-z]/))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [typeMap]);

  const filteredTypes = useMemo(() => {
    if (!search) return allTypes;
    const q = search.toLowerCase();
    return allTypes.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTypes, search]);

  if (!graphqlSchema || !typeMap) {
    return (
      <div className="border-l bg-background w-80 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-semibold uppercase tracking-wider">
            Schema Documentation
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close schema docs"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">
          <div className="text-center space-y-2">
            <p>No schema loaded.</p>
            <p className="text-xs">Click &quot;Refresh Schema&quot; to introspect the endpoint.</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedTypeObj =
    selectedType && graphqlSchema ? graphqlSchema.getType(selectedType) : null;

  return (
    <div className="border-l bg-background w-80 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider">Schema Documentation</span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close schema docs"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedType(null);
            }}
            placeholder="Search types..."
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {selectedTypeObj ? (
          /* Type detail view */
          <div className="p-3">
            <button
              onClick={() => setSelectedType(null)}
              className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
            >
              ← Back to types
            </button>
            <div className="text-sm font-bold text-primary mb-2">{selectedTypeObj.name}</div>
            <p className="text-[11px] text-muted-foreground mb-3">
              {selectedTypeObj.description || "No description"}
            </p>
            {"getFields" in selectedTypeObj && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                  Fields
                </div>
                {Object.values(selectedTypeObj.getFields()).map((field) => (
                  <div key={field.name} className="text-xs border-l-2 border-border pl-2 py-0.5">
                    <div>
                      <span className="font-mono font-medium">{field.name}</span>
                      {": "}
                      <span className="text-primary/70 font-mono text-[11px]">
                        {String(field.type)}
                      </span>
                    </div>
                    {field.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {field.description}
                      </p>
                    )}
                    {field.args.length > 0 && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        <span className="font-medium">Arguments:</span>{" "}
                        {field.args.map((a: { name: string }) => a.name).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Type list */
          <div className="p-3 space-y-3">
            {filteredTypes.map((type) => (
              <button
                key={type.name}
                onClick={() => setSelectedType(type.name)}
                className="w-full text-left hover:bg-muted/50 rounded-md p-2 transition-colors"
              >
                <div className="text-sm font-medium text-primary">{type.name}</div>
                <p className="text-[11px] text-muted-foreground line-clamp-1">
                  {type.description ||
                    `${"getFields" in type ? Object.keys(type.getFields()).length : 0} fields`}
                </p>
              </button>
            ))}
            {filteredTypes.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No types match "{search}"
              </p>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
