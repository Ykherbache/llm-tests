import { backendText } from "@/lib/backend";
import { formatSeconds } from "@/lib/metrics";
import { EFFORT } from "@/lib/effort";
import { modelLabel } from "@/lib/models";
import type { Message } from "@/lib/types";

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" }) {
  return (
    <span
      className={
        tone === "warn"
          ? "rounded-full border-2 border-ink bg-marigold px-2 py-0.5 font-semibold text-black"
          : "rounded-full border-2 border-ink bg-card px-2 py-0.5 font-semibold"
      }
    >
      {children}
    </span>
  );
}

export function MessageStats({ message }: { message: Message }) {
  const m = message.metrics;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      {message.model && <span className="font-bold text-foreground">{modelLabel(message.model)}</span>}
      {message.effort && <Badge>{EFFORT[message.effort].label} effort</Badge>}
      {message.backend && <Badge>{backendText(message.backend.mode, message.backend.numGpu)}</Badge>}
      {m && (
        <>
          <span title={`${m.evalCount} tokens in ${formatSeconds(m.evalDurationMs)}`}>
            {m.tokensPerSecond.toFixed(1)} tok/s
          </span>
          <span>· {m.evalCount.toLocaleString()} tokens</span>
          <span title={`${m.promptCachedTokens} of ${m.promptTokens} prompt tokens reused from cache`}>
            · prompt {m.promptTokens.toLocaleString()}
            {m.cached ? " (cached)" : ""}
          </span>
          {m.coldStart && <Badge tone="warn">cold start · loaded in {formatSeconds(m.loadDurationMs)}</Badge>}
          {m.doneReason === "length" && <Badge tone="warn">hit the token limit</Badge>}
        </>
      )}
      {message.status === "stopped" && <Badge>stopped</Badge>}
    </div>
  );
}
