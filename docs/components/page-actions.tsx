"use client";

import { useState } from "react";

// Per-page LLM affordances: copy the page as markdown, or open the raw
// markdown endpoint (/raw/<path>.md) that llms.txt indexes.
export function PageActions({ markdownUrl }: { markdownUrl: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          const res = await fetch(markdownUrl);
          await navigator.clipboard.writeText(await res.text());
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="border-fd-border text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
      >
        {copied ? "Copied" : "Copy Markdown"}
      </button>
      <a
        href={markdownUrl}
        className="border-fd-border text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
      >
        View as Markdown
      </a>
    </div>
  );
}
