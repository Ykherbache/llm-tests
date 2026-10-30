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
import {
  DEFAULT_VRAM_BYTES,
  fitsIn,
  installedSubtitle,
  isThreadCapped,
  MODELS,
  modelInfo,
  modelLabel,
  modelSubtitle,
  sortForVram,
} from "@/lib/models";
import { IS_DESKTOP } from "@/lib/profile";
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
  /** Desktop: the card nvidia-smi found; null/undefined = none found, 16 GB assumed. */
  gpu?: { name: string; vramBytes: number } | null;
  /** Desktop: a catalogue model that is not downloaded yet was picked. */
  onNeedDownload?: (tag: string) => void;
  triggerRef: Ref<HTMLButtonElement>;
}

function Status({
  tag,
  installed,
  loaded,
  spills,
}: {
  tag: string;
  installed: Set<string> | null;
  loaded: Set<string>;
  spills?: boolean;
}) {
  if (installed && !installed.has(tag)) {
    return <span className={IS_DESKTOP ? "font-semibold" : "text-destructive"}>{IS_DESKTOP ? "download" : "not installed"}{spills && " · spills to RAM"}</span>;
  }
  if (spills) return <span className="font-semibold">{loaded.has(tag) ? "in memory · " : ""}spills to RAM</span>;
  if (loaded.has(tag)) return <span className="font-semibold">in memory</span>;
  return null;
}

interface Entry {
  tag: string;
  label: string;
  subtitle: string;
  sizeBytes: number;
  /** Desktop: too big for the card's video memory, so layers run from RAM. */
  spills?: boolean;
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

export function ModelPicker({ value, disabled, installed, installedModels, loaded, onChange, gpu, onNeedDownload, triggerRef }: Props) {
  // Before Ollama answers (or if it is down) offer the three aliases so the
  // picker is never empty; afterwards list whatever is actually installed.
  const vram = gpu?.vramBytes ?? DEFAULT_VRAM_BYTES;
  const { ready, others } = useMemo(() => {
    if (IS_DESKTOP) {
      // Desktop: the GPU catalogue is always the first list, whatever Ollama already has.
      const catalogue = sortForVram(MODELS, vram).map(
        (m): Entry => ({ tag: m.tag, label: m.label, subtitle: modelSubtitle(m), sizeBytes: 0, spills: !fitsIn(m, vram) }),
      );
      const extra = (installedModels ?? []).filter((m) => !MODELS.some((c) => c.tag === m.tag)).map(entryFor);
      if (!catalogue.some((e) => e.tag === value) && !extra.some((e) => e.tag === value)) {
        extra.push({ tag: value, label: modelLabel(value), subtitle: "", sizeBytes: 0 });
      }
      return { ready: catalogue, others: extra.sort((a, b) => a.sizeBytes - b.sizeBytes) };
    }
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
  }, [installedModels, value, vram]);

  const renderItem = (e: Entry) => (
    <SelectItem key={e.tag} value={e.tag} className="py-2">
      <span className="flex flex-col items-start gap-0.5">
        <span className="font-medium">{e.label}</span>
        {e.subtitle && <span className="text-xs text-muted-foreground">{e.subtitle}</span>}
        <span className="text-xs">
          <span className="font-mono text-muted-foreground break-all">{e.tag}</span>{" "}
          <Status tag={e.tag} installed={installed} loaded={loaded} spills={e.spills} />
        </span>
      </span>
    </SelectItem>
  );

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (typeof v !== "string") return;
        // A catalogue model that is not downloaded cannot answer: offer the download instead.
        if (IS_DESKTOP && installed && !installed.has(v) && MODELS.some((m) => m.tag === v)) onNeedDownload?.(v);
        else onChange(v);
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
            <SelectLabel className="font-bold text-foreground">
              {IS_DESKTOP
                ? `For your GPU (${gpu ? `${gpu.name}, ${Math.round(gpu.vramBytes / 1024 ** 3)} GB` : "16 GB assumed"})`
                : "Ready to chat (6 threads)"}
            </SelectLabel>
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
