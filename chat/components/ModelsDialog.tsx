"use client";

import { Check, ChevronDown, ChevronRight, Copy, Download, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCopy } from "@/hooks/useCopy";
import { Input } from "@/components/ui/input";
import { DEFAULT_VRAM_BYTES, FIT_LABEL, fitFor, MODELS, modelSubtitle, sortByFit, sortForVram, type Fit, type MemoryBudget } from "@/lib/models";
import { catalogVariants, fetchRecommendations, pullModel, searchCatalog, type HealthInfo, type PullProgress } from "@/lib/ollama";
import { IS_DESKTOP } from "@/lib/profile";
import { BOARD_LABEL, recommend, TASK_LABEL, type Rec } from "@/lib/recommend";
import type { CatalogHit, CatalogSource, CatalogVariant, Recommendations, TaskId } from "@/lib/types";

const OLLAMA_DOWNLOAD = "https://ollama.com/download/windows";
const WINGET = "winget install Ollama.Ollama";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  health: HealthInfo | null;
  /** Called after a download finishes so the installed list refreshes. */
  onPulled: () => void;
  onUse: (tag: string) => void;
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
const SOURCES: { id: CatalogSource; label: string }[] = [
  { id: "ollama", label: "Ollama" },
  { id: "hf", label: "Hugging Face" },
];
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

interface RowProps {
  tag: string;
  label: string;
  subtitle: string;
  fit: Fit;
  installed: boolean;
  progress: PullProgress | undefined;
  error: string | undefined;
  disabled: boolean;
  onDownload: (tag: string) => void;
  onCancel: (tag: string) => void;
  onUse: (tag: string) => void;
}

/** One downloadable model: fit badge, Download / Cancel / Use, progress bar, error. */
function PullRow({ tag, label, subtitle, fit, installed, progress: p, error, disabled, onDownload, onCancel, onUse }: RowProps) {
  const pct = p?.total ? Math.min(100, Math.round(((p.completed ?? 0) / p.total) * 100)) : null;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold break-all">
            {label}{" "}
            <span className="rounded-full border-2 border-ink px-1.5 py-0.5 align-middle text-[10px] font-semibold whitespace-nowrap">
              {FIT_LABEL[fit]}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {installed ? (
          <Button size="xs" variant="outline" onClick={() => onUse(tag)}>
            <Check /> Use
          </Button>
        ) : p ? (
          <Button size="xs" variant="outline" onClick={() => onCancel(tag)}>
            <X /> Cancel
          </Button>
        ) : (
          <Button size="xs" onClick={() => onDownload(tag)} disabled={disabled}>
            <Download /> Download
          </Button>
        )}
      </div>
      {p && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full border-2 border-ink bg-card"
          >
            <div className="h-full bg-mint transition-[width]" style={{ width: `${pct ?? 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{p.total ? `${gb(p.completed ?? 0)} / ${gb(p.total)} GB` : p.status}</p>
        </div>
      )}
      {error && <p className="text-xs font-semibold text-destructive">{error}</p>}
    </li>
  );
}

const TASKS: TaskId[] = ["chat", "coding", "overall"];

/**
 * Models from the public leaderboards that fit this machine, on the quality/speed frontier:
 * nothing listed is beaten on both quality and speed by another model that also fits.
 */
function Recommended({ budget, row }: { budget: MemoryBudget; row: (tag: string, label: string, subtitle: string, fit: Fit) => React.ReactNode }) {
  const [data, setData] = useState<Recommendations | null>(null);
  const [task, setTask] = useState<TaskId>("chat");
  useEffect(() => {
    const ctrl = new AbortController();
    fetchRecommendations(ctrl.signal).then(setData, () => {});
    return () => ctrl.abort();
  }, []);
  const result = useMemo(() => (data ? recommend(data.models, task, budget) : null), [data, task, budget]);
  if (!data) return null;

  const line = (r: Rec) => {
    const live = r.model.live?.includes(r.board);
    const age = live ? "live" : `snapshot ${data.boards[r.board].date}`;
    return [
      r.labels.join(" · "),
      `${r.quality} ${BOARD_LABEL[r.board]} (${age})`,
      `${r.measured ? "" : "~"}${Math.round(r.tps)} tok/s${r.measured ? " measured" : " est"}`,
      r.model.verified === false ? "tag not checked by hand" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const rowFor = (r: Rec) => row(r.tag, r.model.names[0], line(r), r.fit);

  return (
    <section aria-label="Recommended for this machine" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Recommended for this machine</h3>
        <div role="group" aria-label="Task" className="flex gap-1">
          {TASKS.map((t) => (
            <Button key={t} size="xs" variant={task === t ? "default" : "outline"} aria-pressed={task === t} onClick={() => setTask(t)}>
              {TASK_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>
      {!result || result.frontier.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">No scored model fits this machine for this task.</p>
      ) : (
        <>
          <ul className="divide-y-2 divide-ink/20">{result.frontier.map(rowFor)}</ul>
          {result.others.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">{result.others.length} more that fit, each beaten on quality and speed</summary>
              <ul className="divide-y-2 divide-ink/20">{result.others.map(rowFor)}</ul>
            </details>
          )}
        </>
      )}
      {result && result.frontier.length + result.others.length < 4 && (
        <p className="text-xs text-muted-foreground">
          Few open models that fit have a {BOARD_LABEL[result.board]} score, so this list is short.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Scores are for full-precision weights; the Q4 downloads are usually a little lower. Speed is estimated from active parameters unless measured here.
      </p>
    </section>
  );
}

type Loadable<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; value: T };

/** A search hit; opening it loads its downloadable sizes. */
function HitItem({ hit, budget, renderRow }: { hit: CatalogHit; budget: MemoryBudget; renderRow: (v: CatalogVariant, fit: Fit) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [variants, setVariants] = useState<Loadable<CatalogVariant[]> | null>(null);
  const toggle = () => {
    setOpen((o) => !o);
    if (variants?.state === "ok" || variants?.state === "loading") return;
    setVariants({ state: "loading" });
    void catalogVariants(hit.source, hit.name, new AbortController().signal).then((r) =>
      setVariants(r.ok ? { state: "ok", value: r.value } : { state: "error", error: r.error }),
    );
  };
  const chips = [...(hit.capabilities ?? []), ...(hit.sizes ?? [])];
  return (
    <li className="py-2">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
        {open ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold break-all">
            {hit.name}
            {hit.downloads ? <span className="ml-2 text-xs font-normal text-muted-foreground">{compact(hit.downloads)} downloads</span> : null}
          </span>
          {hit.description && <span className="block text-xs text-muted-foreground">{hit.description}</span>}
          {chips.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {chips.map((c) => (
                <span key={c} className="rounded-full border-2 border-ink/40 px-1.5 text-[10px] font-semibold">
                  {c}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="ml-6 mt-1">
          {!variants || variants.state === "loading" ? (
            <p className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading sizes…
            </p>
          ) : variants.state === "error" ? (
            <p className="py-2 text-xs font-semibold text-destructive">{variants.error}</p>
          ) : variants.value.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No downloadable files found.</p>
          ) : (
            <ul className="divide-y-2 divide-ink/20">
              {sortByFit(variants.value, budget).map((v) => renderRow(v, fitFor(v.sizeBytes, budget)))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * First-run and "get more models" screen of the desktop build: Ollama missing ->
 * how to install it; otherwise the catalogue with a Download button per model.
 */
export function ModelsDialog({ open, onOpenChange, health, onPulled, onUse }: Props) {
  const { copied, copy } = useCopy();
  const [progress, setProgress] = useState<Record<string, PullProgress>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const installed = new Set(health?.installed ?? []);
  const vram = health?.gpu?.vramBytes ?? DEFAULT_VRAM_BYTES;
  const vramGb = Math.round(vram / 1024 ** 3);
  const memoryBytes = health?.memoryBytes ?? 0;
  const budget: MemoryBudget = { vramBytes: vram, memoryBytes };
  const memoryGb = Math.round(memoryBytes / 1024 ** 3);
  const [source, setSource] = useState<CatalogSource>("ollama");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Loadable<CatalogHit[]> | null>(null);

  // Debounced search; typing again (or switching source) aborts the request in flight.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setResults({ state: "loading" });
      searchCatalog(source, q, ctrl.signal)
        .then((r) => setResults(r.ok ? { state: "ok", value: r.value } : { state: "error", error: r.error }))
        .catch(() => {});
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, source]);

  const download = useCallback(
    async (tag: string) => {
      const ctrl = new AbortController();
      controllers.current.set(tag, ctrl);
      setErrors((e) => ({ ...e, [tag]: "" }));
      setProgress((p) => ({ ...p, [tag]: { status: "starting" } }));
      const error = await pullModel(tag, (line) => setProgress((p) => ({ ...p, [tag]: line })), ctrl.signal);
      controllers.current.delete(tag);
      setProgress((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== tag)));
      if (error) setErrors((e) => ({ ...e, [tag]: error }));
      onPulled();
    },
    [onPulled],
  );

  const ollamaMissing = health !== null && !health.ok;

  const row = (tag: string, label: string, subtitle: string, fit: Fit) => (
    <PullRow
      key={tag}
      tag={tag}
      label={label}
      subtitle={subtitle}
      fit={fit}
      installed={installed.has(tag)}
      progress={progress[tag]}
      error={errors[tag]}
      disabled={!health}
      onDownload={(t) => void download(t)}
      onCancel={(t) => controllers.current.get(t)?.abort()}
      onUse={onUse}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ollamaMissing ? "Install Ollama first" : "Models"}</DialogTitle>
          <DialogDescription>
            {ollamaMissing
              ? IS_DESKTOP
                ? "This app talks to Ollama, which runs the models on your graphics card."
                : "This app talks to Ollama, which runs the models."
              : IS_DESKTOP
                ? `${health?.gpu ? `${health.gpu.name} · ${vramGb} GB` : `No NVIDIA GPU detected, assuming ${vramGb} GB`}. Models bigger than your video memory spill into RAM and get slower.`
                : `${memoryGb} GB of memory. Models much bigger than ${Math.max(memoryGb - 8 - 2, 0)} GB of weights will not run well.`}
          </DialogDescription>
        </DialogHeader>

        {ollamaMissing ? (
          IS_DESKTOP ? (
            <div className="space-y-3 text-sm">
              <p>
                Download and run the installer from{" "}
                <a href={OLLAMA_DOWNLOAD} target="_blank" rel="noreferrer" className="font-semibold underline">
                  ollama.com/download
                </a>
                , or from a terminal:
              </p>
              <div className="flex items-center gap-2 rounded border-2 border-ink bg-card px-2 py-1 font-mono text-xs">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre">{WINGET}</code>
                <button type="button" onClick={() => copy(WINGET)} aria-label="Copy command" className="shrink-0 opacity-70 hover:opacity-100">
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>
              <p className="text-muted-foreground">This window notices Ollama within 15 seconds of it starting.</p>
            </div>
          ) : (
            <p className="text-sm">
              Start it with <code className="font-mono">ollama serve</code>. This window notices Ollama within 15 seconds of it starting.
            </p>
          )
        ) : (
          <div className="space-y-4">
            <section aria-label="Find models" className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models, e.g. qwen3 or llama"
                    aria-label="Search models"
                    maxLength={100}
                    className="pl-8"
                  />
                </div>
                <div role="group" aria-label="Search source" className="flex shrink-0 gap-1">
                  {SOURCES.map((s) => (
                    <Button key={s.id} size="xs" variant={source === s.id ? "default" : "outline"} aria-pressed={source === s.id} onClick={() => setSource(s.id)}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
              {results &&
                (results.state === "loading" ? (
                  <p className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Searching…
                  </p>
                ) : results.state === "error" ? (
                  <p className="py-2 text-xs font-semibold text-destructive">{results.error}</p>
                ) : results.value.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No models found.</p>
                ) : (
                  <ul className="divide-y-2 divide-ink/20">
                    {results.value.map((hit) => (
                      <HitItem
                        key={`${hit.source}:${hit.name}`}
                        hit={hit}
                        budget={budget}
                        renderRow={(v, fit) =>
                          row(v.tag, v.tag, [`${gb(v.sizeBytes)} GB`, v.note].filter(Boolean).join(" · "), fit)
                        }
                      />
                    ))}
                  </ul>
                ))}
            </section>
            {!query.trim() && (IS_DESKTOP || memoryBytes > 0) && <Recommended budget={budget} row={row} />}
            {IS_DESKTOP && !query.trim() && (
              <ul className="divide-y-2 divide-ink/20">
                {sortForVram(MODELS, vram).map((m) =>
                  row(m.tag, m.label, modelSubtitle(m), fitFor(parseFloat(m.size) * 1e9, budget)),
                )}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
