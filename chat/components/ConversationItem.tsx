"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConversationMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  conv: ConversationMeta;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

export function ConversationItem({ conv, active, onSelect, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== conv.title) onRename(draft);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label="Conversation title"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(conv.title);
            setEditing(false);
          }
        }}
        className="w-full rounded-md border-2 border-ink bg-background px-2 py-1.5 text-sm outline-none focus:shadow-brutal-sm"
      />
    );
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center rounded-md border-2 border-transparent text-sm hover:border-ink hover:bg-muted",
          active && "border-ink bg-sidebar-accent font-bold text-black hover:bg-sidebar-accent",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(conv.title);
            setEditing(true);
          }}
          className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
          title={conv.title}
        >
          {conv.title}
        </button>
        <div className="flex shrink-0 pr-1 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <button
            type="button"
            aria-label="Rename"
            onClick={() => {
              setDraft(conv.title);
              setEditing(true);
            }}
            className="rounded p-1 text-current hover:bg-card hover:text-black"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete"
            onClick={() => setConfirming(true)}
            className="rounded p-1 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{conv.title}” and all of its messages will be removed from this browser. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
