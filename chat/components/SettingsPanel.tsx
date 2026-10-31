"use client";

import { useState } from "react";
import { useCopy } from "@/hooks/useCopy";
import type { Updates } from "@/hooks/useUpdates";
import { IS_DESKTOP } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "@/lib/models";
import type { ConversationMeta } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  globalPrompt: string;
  onGlobalPrompt: (text: string) => void;
  conversation: ConversationMeta | null;
  onConversation: (patch: Partial<ConversationMeta>) => void;
  updates: Updates | null;
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </label>
  );
}

/** Copies the /api/diagnostic report, to paste into a bug message. */
function DiagnosticButton() {
  const { copied, copy } = useCopy();
  return (
    <div className="space-y-1 border-t-2 border-ink/20 pt-3">
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          const res = await fetch("/api/diagnostic", { cache: "no-store" });
          copy(await res.text());
        }}
      >
        {copied ? "Copied" : "Copy diagnostic"}
      </Button>
      <p className="text-xs text-muted-foreground">Versions, GPU memory use and the server log. No chats are included.</p>
    </div>
  );
}

/** Shows the running version and lets people check for an update on demand. */
function VersionRow({ updates }: { updates: Updates }) {
  const { state } = updates;
  const busy = state.status === "downloading";
  let note: string | null = null;
  if (state.error && state.status !== "error") note = "Couldn't check for updates. Check your connection.";
  else if (state.upToDate) note = "You're up to date.";
  else if (state.status === "available") note = `Version ${state.version} is available.`;
  else if (state.status === "ready") note = `Version ${state.version} is ready to install.`;
  return (
    <div className="space-y-1 border-t-2 border-ink/20 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">Version {state.current}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void updates.check()}>
          Check for updates
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function MaxTokens({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(draft));
    const clean = Number.isFinite(n) ? Math.min(16384, Math.max(16, n)) : value;
    setDraft(String(clean));
    onCommit(clean);
  };
  return (
    <Input
      id="max-tokens"
      type="number"
      inputMode="numeric"
      min={16}
      max={16384}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="w-28"
    />
  );
}

export function SettingsPanel({ open, onOpenChange, globalPrompt, onGlobalPrompt, conversation, onConversation, updates }: Props) {
  const override = conversation?.systemPrompt ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Changes save automatically.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="global-prompt">Default system prompt (all chats)</Label>
          <Textarea
            id="global-prompt"
            defaultValue={globalPrompt}
            onBlur={(e) => onGlobalPrompt(e.target.value)}
            placeholder="e.g. You are a concise assistant."
            className="min-h-20"
          />
        </div>

        <Separator />

        {conversation ? (
          <div className="space-y-5" key={conversation.id}>
            <p className="text-sm font-bold">This conversation</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="conv-prompt">System prompt override</Label>
                {override === null ? (
                  <Button size="xs" variant="outline" onClick={() => onConversation({ systemPrompt: globalPrompt })}>
                    Override
                  </Button>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => onConversation({ systemPrompt: null })}>
                    Use default
                  </Button>
                )}
              </div>
              {override === null ? (
                <p className="text-xs text-muted-foreground">Using the default system prompt.</p>
              ) : (
                <Textarea
                  id="conv-prompt"
                  defaultValue={override}
                  onBlur={(e) => onConversation({ systemPrompt: e.target.value })}
                  className="min-h-20"
                />
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Temperature</Label>
                <span className="text-sm tabular-nums">{conversation.temperature.toFixed(2)}</span>
              </div>
              <Slider
                min={0}
                max={2}
                step={0.05}
                value={[conversation.temperature]}
                onValueChange={(v) => {
                  const t = Array.isArray(v) ? v[0] : v;
                  if (typeof t === "number") onConversation({ temperature: t });
                }}
                aria-label="Temperature"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="max-tokens">Max tokens</Label>
                <p className="text-xs text-muted-foreground">Includes thinking tokens. Default {DEFAULT_MAX_TOKENS}.</p>
              </div>
              <MaxTokens value={conversation.maxTokens} onCommit={(n) => onConversation({ maxTokens: n })} />
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => onConversation({ temperature: DEFAULT_TEMPERATURE, maxTokens: DEFAULT_MAX_TOKENS })}
            >
              Reset temperature & max tokens
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Start a chat to set per-conversation options.</p>
        )}
        {IS_DESKTOP && <DiagnosticButton />}
        {updates && <VersionRow updates={updates} />}
      </DialogContent>
    </Dialog>
  );
}
