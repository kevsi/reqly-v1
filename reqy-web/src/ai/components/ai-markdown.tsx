"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface AiMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Renders an AI response as formatted markdown.
 *
 * Used everywhere an LLM answer is displayed (sidebar chat, Monu IA page,
 * AIModal, step final text). Safe by default: react-markdown does not render
 * raw HTML, so no sanitization pass is required.
 *
 * Memoized: the sidebar re-renders all messages on every streamed token, and
 * re-parsing unchanged messages' markdown each time would be wasteful.
 */
export const AiMarkdown = memo(function AiMarkdown({ content, className }: AiMarkdownProps) {
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
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border border-border/50 bg-code-bg p-3 font-mono text-xs leading-relaxed text-code-text [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0 [&_code]:text-code-text">
              {children}
            </pre>
          ),
          code: ({ className, children }) => {
            // Fenced blocks carry a `language-xxx` class; anything else is inline code.
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return <code className={cn("font-mono", className)}>{children}</code>;
            }
            return (
              <code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
                {children}
              </code>
            );
          },
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
