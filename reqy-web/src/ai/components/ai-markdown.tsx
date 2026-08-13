"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Check, Clipboard, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { parseCurlRequest, type ParsedCodeRequest } from "@/src/ai/agent/code-request";

interface AiMarkdownProps {
  content: string;
  className?: string;
  onExecuteRequest?: (request: ParsedCodeRequest) => void;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

function CodeBlock({
  className,
  children,
  onExecuteRequest,
}: {
  className?: string;
  children: React.ReactNode;
  onExecuteRequest?: (request: ParsedCodeRequest) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const source = String(children).replace(/\n$/, "");
  const isBlock = /language-/.test(className ?? "");

  if (!isBlock) {
    return (
      <code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    );
  }

  const language = className?.match(/language-([^\s]+)/)?.[1] ?? "text";
  const parsedRequest = parseCurlRequest(source);

  const handleCopy = async () => {
    const success = await copyText(source);
    if (!success) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/60 bg-code-bg text-code-text">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-background/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono uppercase tracking-wide">{language}</span>
        <div className="flex items-center gap-1">
          {parsedRequest && onExecuteRequest && (
            <button
              type="button"
              onClick={() => onExecuteRequest(parsedRequest)}
              className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary"
              title={t("ai.code.executeTitle")}
              aria-label={t("ai.code.executeTitle")}
              data-testid="ai-code-execute"
            >
              <Play className="size-3" />
              {t("ai.code.execute")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={copied ? t("ai.code.copied") : t("ai.code.copy")}
            aria-label={copied ? t("ai.code.copied") : t("ai.code.copy")}
            data-testid="ai-code-copy"
          >
            {copied ? <Check className="size-3 text-success" /> : <Clipboard className="size-3" />}
            {copied ? t("ai.code.copied") : t("ai.code.copy")}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-code-text">
        <code className={cn("font-mono", className)}>{children}</code>
      </pre>
    </div>
  );
}

/**
 * Renders an AI response as formatted markdown with per-code-block actions.
 * Safe by default: react-markdown does not render raw HTML.
 */
export const AiMarkdown = memo(function AiMarkdown({
  content,
  className,
  onExecuteRequest,
}: AiMarkdownProps) {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed [&>p]:my-0">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-2.5 text-base font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-2.5 text-[15px] font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          pre: ({ children }) => <>{children}</>,
          code: ({ className: codeClassName, children }) => (
            <CodeBlock className={codeClassName} onExecuteRequest={onExecuteRequest}>
              {children}
            </CodeBlock>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
          input: ({ type, checked }) => (
            <input type={type} checked={checked} disabled className="mr-1.5 align-middle" />
          ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt ?? ""}
              loading="lazy"
              className="my-2 max-h-64 max-w-full rounded-lg"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
