"use client";

import { useState, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

interface JsonNodeProps {
  name: string | null;
  value: unknown;
  depth: number;
  defaultExpanded?: boolean;
}

// ── Color helpers ─────────────────────────────────────────────────────────

const keyColor = "text-sky-600 dark:text-sky-400";
const stringColor = "text-amber-600 dark:text-amber-400";
const numberColor = "text-rose-600 dark:text-rose-400";
const booleanColor = "text-violet-600 dark:text-violet-400";
const nullColor = "text-orange-600 dark:text-orange-300";
const bracketColor = "text-muted-foreground";
const collapsedColor = "text-muted-foreground/60 italic text-xs ml-2";

function typeColor(value: unknown): string {
  if (typeof value === "string") return stringColor;
  if (typeof value === "number") return numberColor;
  if (typeof value === "boolean") return booleanColor;
  if (value === null) return nullColor;
  return "";
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return String(value);
}

// ── JsonLeaf: renders a primitive value ───────────────────────────────────

const JsonLeaf = memo(function JsonLeaf({ name, value }: { name: string | null; value: unknown }) {
  return (
    <span className="inline">
      {name !== null && (
        <>
          <span className={keyColor}>&quot;{name}&quot;</span>
          <span className={bracketColor}>: </span>
        </>
      )}
      <span className={cn(typeColor(value), typeof value === "string" && "break-all")}>
        {formatValue(value)}
      </span>
    </span>
  );
});

// ── JsonNode: renders any JSON value (recursive) ─────────────────────────

const JsonNode = memo(function JsonNode({
  name,
  value,
  depth,
  defaultExpanded = true,
}: JsonNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 3);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const indent = "  ".repeat(depth);

  // Primitive
  if (value === null || typeof value !== "object") {
    return (
      <div className="leading-relaxed whitespace-pre">
        {indent}
        <JsonLeaf name={name} value={value} />
      </div>
    );
  }

  // Array
  if (Array.isArray(value)) {
    const isEmpty = value.length === 0;
    const hasExpandedItems = expanded && !isEmpty;

    return (
      <div className="leading-relaxed">
        <div className="whitespace-pre">
          {indent}
          {name !== null && (
            <>
              <span className={keyColor}>&quot;{name}&quot;</span>
              <span className={bracketColor}>: </span>
            </>
          )}
          {/* Toggle button */}
          {!isEmpty && (
            <button
              onClick={toggle}
              className="inline-flex items-center align-middle mr-0.5 size-4 rounded hover:bg-accent transition-colors cursor-pointer"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronDown className="size-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 text-muted-foreground" />
              )}
            </button>
          )}
          <span className={bracketColor}>[</span>
          {isEmpty && <span className={bracketColor}>]</span>}
          {!expanded && !isEmpty && (
            <span className={collapsedColor}>
              {value.length} item{value.length > 1 ? "s" : ""}
            </span>
          )}
          {!expanded && !isEmpty && <span className={bracketColor}>]</span>}
        </div>
        {hasExpandedItems && (
          <div className="ml-4 border-l border-border/30 pl-2">
            {value.map((item, index) => (
              <JsonNode
                key={index}
                name={null}
                value={item}
                depth={depth + 1}
                defaultExpanded={depth < 2}
              />
            ))}
            <div className="whitespace-pre text-muted-foreground/60">
              {indent}
              <span className={bracketColor}>]</span>
            </div>
          </div>
        )}
        {!isEmpty && !hasExpandedItems && null}
      </div>
    );
  }

  // Object
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const isEmpty = keys.length === 0;
  const hasExpandedItems = expanded && !isEmpty;

  return (
    <div className="leading-relaxed">
      <div className="whitespace-pre">
        {indent}
        {name !== null && (
          <>
            <span className={keyColor}>&quot;{name}&quot;</span>
            <span className={bracketColor}>: </span>
          </>
        )}
        {/* Toggle button */}
        {!isEmpty && (
          <button
            onClick={toggle}
            className="inline-flex items-center align-middle mr-0.5 size-4 rounded hover:bg-accent transition-colors cursor-pointer"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="size-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
          </button>
        )}
        <span className={bracketColor}>{`{`}</span>
        {isEmpty && <span className={bracketColor}>{`}`}</span>}
        {!expanded && !isEmpty && (
          <span className={collapsedColor}>
            {keys.length} key{keys.length > 1 ? "s" : ""}
          </span>
        )}
        {!expanded && !isEmpty && <span className={bracketColor}>{`}`}</span>}
      </div>
      {hasExpandedItems && (
        <div className="ml-4 border-l border-border/30 pl-2">
          {keys.map((key) => (
            <JsonNode
              key={key}
              name={key}
              value={obj[key]}
              depth={depth + 1}
              defaultExpanded={depth < 2}
            />
          ))}
          <div className="whitespace-pre text-muted-foreground/60">
            {indent}
            <span className={bracketColor}>{`}`}</span>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Main export ────────────────────────────────────────────────────────────

interface JsonTreeViewerProps {
  data: unknown;
  className?: string;
  /** Default expand depth (default: 3). Higher = more expanded. */
  defaultExpandDepth?: number;
}

export function JsonTreeViewer({ data, className }: JsonTreeViewerProps) {
  if (data === undefined || data === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground italic">
        {data === null ? "null" : "undefined"}
      </div>
    );
  }

  return (
    <div className={cn("overflow-auto font-mono text-sm leading-relaxed p-4", className)}>
      <JsonNode name={null} value={data} depth={0} defaultExpanded={true} />
    </div>
  );
}
