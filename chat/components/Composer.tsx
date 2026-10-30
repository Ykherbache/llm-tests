"use client";

import { ArrowUp, Gauge, Globe, Loader2, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EFFORT, EFFORTS } from "@/lib/effort";
import type { Effort } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  generating: boolean;
  /** Reason sending is blocked (context full, model missing...), or null. */
  blockedReason: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Web tools toggle: the user's setting, and whether SearXNG is reachable. */
  toolsOn: boolean;
  searchAvailable: boolean;
  /** SearXNG is down: clicking the greyed globe starts it. */
  searchStarting: boolean;
  searchError: string | null;
  onStartSearch: () => void;
  onToggleTools: () => void;
  /** How hard the model works on the next reply. */
  effort: Effort;
  onEffort: (e: Effort) => void;
}

export interface ComposerHandle {
  focus: () => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { generating, blockedReason, onSend, onStop, toolsOn, searchAvailable, searchStarting, searchError, onStartSearch, onToggleTools, effort, onEffort },
  ref,
) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), []);

  // Auto-grow up to the CSS max-height.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const canSend = !generating && !blockedReason && text.trim() !== "";
  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="flex items-end gap-2 rounded-xl border-2 border-ink bg-card p-2 shadow-brutal transition-shadow focus-within:shadow-brutal-lg">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                aria-pressed={toolsOn && searchAvailable}
                aria-label="Web search tools"
                aria-busy={searchStarting}
                disabled={searchStarting}
                onClick={searchAvailable ? onToggleTools : onStartSearch}
                className={cn(toolsOn && searchAvailable ? "border-ink bg-mint text-black" : "text-muted-foreground")}
              />
            }
          >
            {searchStarting ? <Loader2 className="animate-spin" /> : <Globe className={cn(!searchAvailable && "opacity-50")} />}
          </TooltipTrigger>
          <TooltipContent>
            {searchStarting
              ? "Starting SearXNG…"
              : !searchAvailable
                ? (searchError ?? "Web search is off (SearXNG isn't running) — click to start it")
                : toolsOn
                ? "Web search on: the model can search and read pages"
                : "Web search off"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button variant="ghost" aria-label={`Effort: ${EFFORT[effort].label}`} className="gap-1 px-2 text-xs text-muted-foreground" />}
                />
              }
            >
              <Gauge />
              <span className="hidden sm:inline">{EFFORT[effort].label}</span>
            </TooltipTrigger>
            <TooltipContent>Effort: {EFFORT[effort].hint}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuRadioGroup value={effort} onValueChange={(v) => onEffort(v as Effort)}>
              {EFFORTS.map((e) => (
                <DropdownMenuRadioItem key={e} value={e} className="flex-col items-start gap-0">
                  <span className="font-semibold">{EFFORT[e].label}</span>
                  <span className="text-xs text-muted-foreground">{EFFORT[e].hint}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <textarea
          ref={area}
          value={text}
          rows={1}
          autoFocus
          placeholder={blockedReason ?? "Message your local model…"}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-52 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none focus-visible:outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {generating ? (
          <Button size="icon-lg" variant="secondary" onClick={onStop} aria-label="Stop generating (Esc)">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button size="icon-lg" onClick={submit} disabled={!canSend} aria-label="Send (Enter)">
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
});
