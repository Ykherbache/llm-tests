"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { groupConversations } from "@/lib/dates";
import type { ConversationMeta } from "@/lib/types";
import { ConversationItem } from "./ConversationItem";

interface Props {
  conversations: ConversationMeta[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ conversations, activeId, onNew, onSelect, onRename, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    return groupConversations(list);
  }, [conversations, query]);

  return (
    <div className="flex h-full flex-col gap-3 bg-sidebar p-3 text-sidebar-foreground">
      <Button className="justify-start gap-2" onClick={onNew}>
        <Plus /> New chat
        <kbd className="ml-auto rounded-full border-2 border-ink bg-card px-1.5 text-[10px] font-semibold text-card-foreground">Ctrl/⌘K</kbd>
      </Button>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="w-full rounded-md border-2 border-ink bg-background py-1.5 pr-2 pl-8 text-sm outline-none focus:shadow-brutal-sm"
        />
      </div>
      <nav className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-label="Conversations">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {query ? "No chats match." : "No chats yet."}
          </p>
        )}
        {groups.map(({ group, items }) => (
          <section key={group} className="mb-3">
            <h2 className="px-2 pb-1 text-sm font-bold">{group}</h2>
            <ul className="space-y-1">
              {items.map((c) => (
                <li key={c.id}>
                  <ConversationItem
                    conv={c}
                    active={c.id === activeId}
                    onSelect={() => onSelect(c.id)}
                    onRename={(t) => onRename(c.id, t)}
                    onDelete={() => onDelete(c.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <p className="px-2 text-xs text-muted-foreground">Stored only in this browser (IndexedDB).</p>
    </div>
  );
}
