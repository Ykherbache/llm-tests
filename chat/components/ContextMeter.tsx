import { CONTEXT_WINDOW } from "@/lib/models";
import { cn } from "@/lib/utils";

export const CONTEXT_WARN = 0.8;
export const CONTEXT_BLOCK = 0.95;

/** Prompt size of the latest reply (prompt_eval_count) against the 16k window. */
export function ContextMeter({ tokens }: { tokens: number }) {
  const ratio = Math.min(1, tokens / CONTEXT_WINDOW);
  const tone = ratio > CONTEXT_BLOCK ? "bg-destructive" : ratio > CONTEXT_WARN ? "bg-marigold" : "bg-mint";
  return (
    <div
      className="flex items-center gap-2 text-xs font-semibold tabular-nums"
      title={`${tokens.toLocaleString()} of ${CONTEXT_WINDOW.toLocaleString()} context tokens used by the last prompt`}
    >
      <div className="hidden h-3 w-20 overflow-hidden rounded-full border-2 border-ink bg-card sm:block" role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Context used">
        <div className={cn("h-full transition-[width]", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className={cn(ratio > CONTEXT_WARN && "rounded-full border-2 border-ink bg-marigold px-1.5 text-black", ratio > CONTEXT_BLOCK && "bg-destructive")}>
        {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}
