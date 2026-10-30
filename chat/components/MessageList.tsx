"use client";

import { ArrowDown } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { Phase } from "@/hooks/useChat";
import { modelInfo, modelSubtitle } from "@/lib/models";
import type { Message as Msg } from "@/lib/types";
import { Message } from "./Message";

interface Props {
  conversationId: string | null;
  messages: Msg[];
  phase: Phase;
  busy: boolean;
  model: string;
  onRetry: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}

function EmptyState({ model }: { model: string }) {
  const info = modelInfo(model);
  return (
    <div className="m-auto flex max-w-xl flex-col items-center justify-center gap-5 px-2 text-center">
      <div className="max-w-full rounded-xl border-2 border-ink bg-primary px-6 py-5 text-black shadow-brutal-lg">
        <h1
          className="text-4xl leading-none font-black tracking-tight break-words sm:text-6xl"
          style={{ fontStretch: "125%" }}
        >
          {info?.label ?? model}
        </h1>
        {info && <p className="mt-3 text-sm font-semibold">{modelSubtitle(info)}</p>}
      </div>
      <ul className="flex flex-wrap justify-center gap-2 text-sm" aria-label="Keyboard shortcuts">
        {[
          ["Enter", "send"],
          ["Shift+Enter", "new line"],
          ["Esc", "stop"],
          ["Ctrl/⌘ K", "new chat"],
          ["Ctrl/⌘ Shift O", "pick a model"],
        ].map(([key, what]) => (
          <li key={key} className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-card py-0.5 pr-3 pl-0.5">
            <kbd className="rounded-full bg-marigold px-2 py-0.5 text-xs font-bold text-black">{key}</kbd>
            {what}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MessageList({ conversationId, messages, phase, busy, model, ...handlers }: Props) {
  const { containerRef, contentRef, atBottom, scrollToBottom } = useAutoScroll<HTMLDivElement, HTMLDivElement>();

  // Opening another conversation starts at its latest message.
  useEffect(() => scrollToBottom(), [conversationId, scrollToBottom]);
  const last = messages.at(-1);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState model={model} />
          ) : (
            messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                phase={m.status === "streaming" ? phase : undefined}
                busy={busy}
                {...handlers}
              />
            ))
          )}
        </div>
      </div>
      {!atBottom && last && (
        <Button
          size="icon"
          variant="outline"
          aria-label="Scroll to bottom"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}
