"use client";

import { useMemo, type Ref } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HealthInfo } from "@/lib/ollama";
import { installedSubtitle, isThreadCapped, MODELS, modelInfo, modelLabel, modelSubtitle } from "@/lib/models";
import { cn } from "@/lib/utils";

type Installed = NonNullable<HealthInfo["installedModels"]>[number];

interface Props {
  value: string;
  disabled: boolean;
  installed: Set<string> | null;
  /** Everything Ollama has, with sizes; undefined until the first health check. */
  installedModels: Installed[] | undefined;
  loaded: Set<string>;
  onChange: (tag: string) => void;
  triggerRef: Ref<HTMLButtonElement>;
}

function Status({ tag, installed, loaded }: { tag: string; installed: Set<string> | null; loaded: Set<string> }) {
  if (installed && !installed.has(tag)) return <span className="text-destructive">not installed</span>;
  if (loaded.has(tag)) return <span className="font-semibold">in memory</span>;
  return null;
}

interface Entry {
  tag: string;
  label: string;
  subtitle: string;
  sizeBytes: number;
}

function entryFor(m: Installed): Entry {
  const info = modelInfo(m.tag);
  return {
    tag: m.tag,
    label: info?.label ?? modelLabel(m.tag),
    subtitle: info ? modelSubtitle(info) : installedSubtitle(m),
    sizeBytes: m.sizeBytes,
  };
}

export function ModelPicker({ value, disabled, installed, installedModels, loaded, onChange, triggerRef }: Props) {
  // Before Ollama answers (or if it is down) offer the three aliases so the
  // picker is never empty; afterwards list whatever is actually installed.
  const { ready, others } = useMemo(() => {
    const entries: Entry[] = installedModels?.length
      ? installedModels.map(entryFor)
      : MODELS.map((m) => ({ tag: m.tag, label: m.label, subtitle: modelSubtitle(m), sizeBytes: 0 }));
    // A model chosen earlier that has since been removed still needs a row.
    if (!entries.some((e) => e.tag === value)) {
      entries.push({ tag: value, label: modelLabel(value), subtitle: "", sizeBytes: 0 });
    }
    return {
      ready: entries.filter((e) => isThreadCapped(e.tag)),
      others: entries.filter((e) => !isThreadCapped(e.tag)).sort((a, b) => a.sizeBytes - b.sizeBytes),
    };
  }, [installedModels, value]);

  const renderItem = (e: Entry) => (
    <SelectItem key={e.tag} value={e.tag} className="py-2">
      <span className="flex flex-col items-start gap-0.5">
        <span className="font-medium">{e.label}</span>
        {e.subtitle && <span className="text-xs text-muted-foreground">{e.subtitle}</span>}
        <span className="text-xs">
          <span className="font-mono text-muted-foreground break-all">{e.tag}</span>{" "}
          <Status tag={e.tag} installed={installed} loaded={loaded} />
        </span>
      </span>
    </SelectItem>
  );

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (typeof v === "string") onChange(v);
      }}
      disabled={disabled}
    >
      <SelectTrigger ref={triggerRef} aria-label="Model (Ctrl/⌘+Shift+O)" className="h-10 max-w-[60vw] font-bold sm:max-w-none">
        <SelectValue>
          {(v: string) => (
            <span className="flex items-center gap-2 truncate">
              <span
                className={cn("size-3 shrink-0 rounded-full border-2 border-ink", loaded.has(v) ? "bg-mint" : "bg-muted")}
                aria-hidden
              />
              {modelLabel(v)}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="max-h-[70vh] min-w-72">
        {ready.length > 0 && (
          <SelectGroup>
            <SelectLabel className="font-bold text-foreground">Ready to chat (6 threads)</SelectLabel>
            {ready.map(renderItem)}
          </SelectGroup>
        )}
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel className="font-bold text-foreground">Other installed models</SelectLabel>
            {others.map(renderItem)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
