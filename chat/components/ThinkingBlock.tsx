"use client";

import { Brain, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useElapsed } from "@/hooks/useElapsed";
import { formatSeconds } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  /** True while reasoning tokens are still arriving. */
  live: boolean;
  startedAt: number;
  durationMs?: number;
}

/** The model's reasoning channel (message.thinking), collapsed by default. */
export function ThinkingBlock({ text, live, startedAt, durationMs }: Props) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(startedAt, live, 1000);
  const label = live
    ? `Thinking… ${formatSeconds(elapsed)}`
    : `Thought for ${formatSeconds(durationMs ?? 0)}`;

  return (
    <div className="mb-3 rounded-md border-2 border-ink bg-card text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        <Brain className={cn("size-4", live && "animate-pulse")} />
        <span>{label}</span>
        <span className="ml-auto text-xs tabular-nums">{text.length.toLocaleString()} chars</span>
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t-2 px-3 py-2 whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}
