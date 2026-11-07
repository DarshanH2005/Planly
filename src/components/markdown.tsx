"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/components/ui/cn";

function prepareTutorContent(content: string) {
  return content
    // Revision identifiers belong to the transport record, never the lesson.
    .replace(/\s*Referenced code rev\s+\d+\s*/gi, "\n")
    // The tutor commonly uses short inline math such as $O(1)$. Until the
    // curriculum needs a full math renderer, present this cleanly as code
    // instead of exposing dollar delimiters in the lesson copy.
    .replace(/\$([^$\n]+)\$/g, "`$1`")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// SOTA tutor markdown: quiet typography, theme tokens, no blue dumps.
// Tables/lists/code constrained to bubble width. Sanitized by default
// (react-markdown escapes raw HTML unless rehype-raw is added — we don't add it).
export function TutorMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("tutor-md text-[14px] leading-[1.65]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 marker:text-muted">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 marker:text-muted">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ className: codeClass, children }) => {
            const isBlock = String(codeClass ?? "").includes("language-");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-[5px] border border-border bg-background px-1 py-px font-mono text-[12px] text-foreground">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-2 overflow-x-auto last:mb-0">{children}</pre>,
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-[12.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-surface-muted px-2.5 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/60 px-2.5 py-1.5 align-top last:border-b-0">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-border-strong pl-3 text-muted-strong">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:brightness-110">
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="mb-4 mt-6 text-xl font-semibold tracking-tight first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-6 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold first:mt-0">{children}</h3>,
        }}
      >
        {prepareTutorContent(content)}
      </ReactMarkdown>
    </div>
  );
}
