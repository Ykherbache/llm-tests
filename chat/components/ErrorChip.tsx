"use client";

import { AlertTriangle, Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/useCopy";
import { modelInfo } from "@/lib/models";
import type { ChatErrorInfo } from "@/lib/types";

function Command({ cmd }: { cmd: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2 rounded border-2 border-ink bg-card px-2 py-1 font-mono text-xs font-normal">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre">{cmd}</code>
      <button type="button" onClick={() => copy(cmd)} aria-label="Copy command" className="shrink-0 opacity-70 hover:opacity-100">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function describe(err: ChatErrorInfo): { title: string; commands: string[] } {
  switch (err.code) {
    case "ollama_down":
      return { title: "Ollama isn't running — start it with `ollama serve`.", commands: ["ollama serve"] };
    case "model_not_found": {
      const info = err.model ? modelInfo(err.model) : undefined;
      // The tags are local aliases, so a bare `ollama pull <alias>` cannot work:
      // pull the base weights, then recreate the thread-capped alias.
      return {
        title: `Model \`${err.model ?? "unknown"}\` isn't installed in Ollama.`,
        commands: info
          ? [`ollama pull ${info.baseRef}`, `./setup.sh --threads 6 --alias ${info.registryKey}`]
          : [`ollama pull ${err.model ?? "<model>"}`],
      };
    }
    default:
      return { title: err.message, commands: [] };
  }
}

export function ErrorChip({ error, onRetry }: { error: ChatErrorInfo; onRetry?: () => void }) {
  const { title, commands } = describe(error);
  const showDetail = error.code === "model_not_found" && error.message && !title.includes(error.message);
  return (
    <div role="alert" className="mt-2 space-y-2 rounded-md border-2 border-ink bg-destructive p-3 text-sm font-semibold text-black shadow-brutal-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 break-words">
          <p>{title}</p>
          {showDetail && <p className="text-xs font-normal">{error.message}</p>}
        </div>
        {onRetry && (
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RotateCcw /> Retry
          </Button>
        )}
      </div>
      {commands.map((c) => (
        <Command key={c} cmd={c} />
      ))}
    </div>
  );
}
