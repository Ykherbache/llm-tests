"use client";

import { Check, Copy, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  disabled: boolean;
  align: "start" | "end";
  onRetry?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}

function Action({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={label} onClick={onClick} disabled={disabled} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Hover actions; always visible on touch-sized screens. */
export function MessageActions({ text, disabled, align, onRetry, onEdit, onDelete }: Props) {
  const { copied, copy } = useCopy();
  return (
    <div
      className={cn(
        "mt-1 flex gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
        align === "end" && "justify-end",
      )}
    >
      <Action label={copied ? "Copied" : "Copy"} onClick={() => copy(text)}>
        {copied ? <Check /> : <Copy />}
      </Action>
      {onEdit && (
        <Action label="Edit and resend" onClick={onEdit} disabled={disabled}>
          <Pencil />
        </Action>
      )}
      {onRetry && (
        <Action label="Retry" onClick={onRetry} disabled={disabled}>
          <RotateCcw />
        </Action>
      )}
      <Action label="Delete" onClick={onDelete} disabled={disabled}>
        <Trash2 />
      </Action>
    </div>
  );
}
