import { Lang, parseAsync, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import pythonLang from "@ast-grep/lang-python";
import rustLang from "@ast-grep/lang-rust";
import goLang from "@ast-grep/lang-go";
import * as path from "node:path";
import type { AstGrepMatch, AstGrepRule, MatchedNode } from "./types.ts";

export const SUPPORTED_LANGUAGES = [
  "javascript",
  "typescript",
  "tsx",
  "python",
  "rust",
  "go",
] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

let registered = false;
export function ensureLangRegistration(): void {
  if (registered) return;
  registerDynamicLanguage({ python: pythonLang, rust: rustLang, go: goLang });
  registered = true;
}

function toNapiLang(lang: string): Lang | string {
  switch (lang) {
    case "javascript":
      return Lang.JavaScript;
    case "typescript":
      return Lang.TypeScript;
    case "tsx":
      return Lang.Tsx;
    default:
      return lang;
  }
}

/** Picks the ast-grep language from a file extension, falling back to the
 * detector's declared language. */
export function langForFile(file: string, fallback: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
    case ".jsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    default:
      return fallback;
  }
}

class NodeWrapper implements MatchedNode {
  private readonly inner: SgNode;

  constructor(node: SgNode) {
    this.inner = node;
  }

  text(): string {
    return this.inner.text();
  }
  kind(): string {
    return String(this.inner.kind());
  }
  line(): number {
    return this.inner.range().start.line + 1;
  }
  get(name: string): string | undefined {
    return this.inner.getMatch(name)?.text();
  }
  getAll(name: string): string[] {
    return this.inner.getMultipleMatches(name).map((n) => n.text());
  }
  parent(): MatchedNode | null {
    const p = this.inner.parent();
    return p ? new NodeWrapper(p) : null;
  }
  children(): MatchedNode[] {
    return this.inner.children().map((c) => new NodeWrapper(c));
  }
}

/**
 * Runs all rules against one source file. Parses the file once, caches per
 * (lang, src) for reuse across rules and callers.
 */
export async function runRules(
  lang: string,
  src: string,
  rules: AstGrepRule[],
): Promise<AstGrepMatch[]> {
  ensureLangRegistration();
  const root = await parseAsync(toNapiLang(lang), src);
  const out: AstGrepMatch[] = [];
  for (const rule of rules) {
    const query = rule.kind
      ? { pattern: rule.pattern, kind: rule.kind }
      : { pattern: rule.pattern };
    const nodes = root.root().findAll({ rule: query });
    for (const node of nodes) {
      out.push({
        ruleId: rule.id,
        file: "",
        lang,
        line: node.range().start.line + 1,
        text: node.text(),
        node: new NodeWrapper(node),
      });
    }
  }
  return out;
}

export type { SgNode };
