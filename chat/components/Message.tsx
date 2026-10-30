"use client";

import { Loader2 } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useElapsed } from "@/hooks/useElapsed";
import type { Phase } from "@/hooks/useChat";
import { formatSeconds } from "@/lib/metrics";
import { modelLabel } from "@/lib/models";
import type { Message as Msg } from "@/lib/types";
import { ErrorChip } from "./ErrorChip";
import { Markdown } from "./Markdown";
import { MessageActions } from "./MessageActions";
import { MessageStats } from "./MessageStats";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolSteps } from "./ToolSteps";

interface Props {
  message: Msg;
  /** Only passed to the message currently streaming. */
  phase?: Phase;
  busy: boolean;
  onRetry: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}

function Waiting({ phase }: { phase: Phase }) {
  const elapsed = useElapsed(phase.startedAt, true);
  const text =
    phase.kind === "loading"
      ? `Loading ${modelLabel(phase.model)} into memory… ${formatSeconds(elapsed)} (first reply after a switch takes 10–40 s)`
      : `Waiting for the model… ${formatSeconds(elapsed)}`;
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      <Loader2 className="size-4 animate-spin" />
      {text}
    </div>
  );
}

function UserMessage({ message, busy, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    const submit = () => {
      if (busy || !draft.trim()) return;
      setEditing(false);
      onEdit(message.id, draft);
    };
    return (
      <div className="ml-auto w-full max-w-[85%] space-y-2">
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="max-h-80 min-h-20"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !draft.trim()}>
            Save & send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group ml-auto flex max-w-[85%] flex-col items-end pr-0.5">
      <div className="rounded-xl border-2 border-ink bg-primary px-4 py-2.5 break-words whitespace-pre-wrap text-black shadow-brutal-sm">{message.content}</div>
      <MessageActions
        text={message.content}
        disabled={busy}
        align="end"
        onEdit={() => {
          setDraft(message.content);
          setEditing(true);
        }}
        onDelete={() => onDelete(message.id)}
      />
    </div>
  );
}

function AssistantMessage({ message, phase, busy, onRetry, onDelete }: Props) {
  const streaming = message.status === "streaming";
  const thinking = message.thinking ?? "";
  const thinkingLive = streaming && phase?.kind === "thinking";
  const steps = message.toolSteps ?? [];
  // While a tool runs, its own row shows the spinner.
  const showWaiting = streaming && phase && phase.kind !== "tool" && !message.content && (!thinking || phase.kind !== "thinking");

  return (
    <div className="group min-w-0">
      {steps.length > 0 && <ToolSteps steps={steps} />}
      {thinking && (
        <ThinkingBlock
          text={thinking}
          live={thinkingLive}
          startedAt={phase?.thinkingStartedAt || message.createdAt}
          durationMs={message.thinkingMs}
        />
      )}
      {showWaiting && <Waiting phase={phase} />}
      {/* While streaming: cheap pre-wrap text. Markdown is parsed once, at the end. */}
      {streaming ? (
        message.content && <div className="leading-7 break-words whitespace-pre-wrap">{message.content}</div>
      ) : (
        message.content && <Markdown text={message.content} />
      )}
      {message.error && (
        <ErrorChip error={message.error} onRetry={busy ? undefined : () => onRetry(message.id)} />
      )}
      {!streaming && (
        <>
          <MessageStats message={message} />
          <MessageActions
            text={message.content}
            disabled={busy}
            align="start"
            onRetry={() => onRetry(message.id)}
            onDelete={() => onDelete(message.id)}
          />
        </>
      )}
    </div>
  );
}

export const Message = memo(function Message(props: Props) {
  return props.message.role === "user" ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});
