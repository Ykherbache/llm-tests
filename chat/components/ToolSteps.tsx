"use client";

import { AlertCircle, ChevronRight, FileText, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toolLabel } from "@/lib/tools";
import type { ToolStep } from "@/lib/types";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Step({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const search = step.name === "web_search";
  const enable = step.name === "enable_web_search";
  const Icon =
    step.status === "running" ? Loader2 : step.status === "error" ? AlertCircle : search || enable ? Globe : FileText;
  const label =
    step.status === "running"
      ? `${toolLabel(step.name, step.args)}…`
      : enable
        ? "Turned on web search"
        : search
        ? `Searched “${String(step.args.query ?? "")}”${step.hits ? ` · ${step.hits.length} results` : ""}`
        : `Read ${step.page ? hostOf(step.page.url) : hostOf(String(step.args.url ?? ""))}${step.page?.truncated ? " (truncated)" : ""}`;
  const expandable = step.status === "done" && ((search && !!step.hits?.length) || !!step.page);

  return (
    <li>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-muted-foreground enabled:hover:text-foreground"
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            step.status === "running" && "animate-spin",
            step.status === "error" && "text-destructive",
          )}
        />
        <span className="min-w-0 truncate">{label}</span>
        {expandable && <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />}
      </button>
      {step.status === "error" && step.error && (
        <p className="pl-5.5 text-xs break-words text-destructive">{step.error}</p>
      )}
      {open && search && step.hits && (
        <ol className="space-y-1 py-1 pl-5.5">
          {step.hits.map((h) => (
            <li key={h.url} className="min-w-0">
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="block truncate text-foreground hover:underline">
                {h.title}
              </a>
              <span className="block truncate text-xs">{hostOf(h.url)}</span>
            </li>
          ))}
        </ol>
      )}
      {open && step.page && (
        <p className="py-1 pl-5.5">
          <a href={step.page.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
            {step.page.title}
          </a>{" "}
          <span className="text-xs">· {step.page.chars.toLocaleString()} chars read</span>
        </p>
      )}
    </li>
  );
}

/** The tool calls behind a reply: searches and pages read, in order. */
export function ToolSteps({ steps }: { steps: ToolStep[] }) {
  return (
    <ul className="mb-3 space-y-0.5 rounded-md border-2 border-ink bg-card px-3 py-2 text-sm" aria-label="Tool calls">
      {steps.map((s) => (
        <Step key={s.id} step={s} />
      ))}
    </ul>
  );
}
