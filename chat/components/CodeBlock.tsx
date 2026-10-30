"use client";

import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useCopy } from "@/hooks/useCopy";

interface Props {
  language: string;
  raw: string;
  children: ReactNode;
}

export function CodeBlock({ language, raw, children }: Props) {
  const { copied, copy } = useCopy();
  return (
    <div className="not-prose my-3 overflow-hidden rounded-md border-2 border-ink bg-card shadow-brutal-sm">
      <div className="flex items-center justify-between border-b-2 border-ink bg-marigold px-3 py-1 text-xs font-semibold text-black">
        <span className="font-mono">{language || "text"}</span>
        <button
          type="button"
          onClick={() => copy(raw)}
          className="inline-flex items-center gap-1 rounded border-2 border-transparent px-1.5 py-0.5 hover:border-ink hover:bg-card"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}
