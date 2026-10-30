"use client";

import { Check, Copy, Download, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCopy } from "@/hooks/useCopy";
import { DEFAULT_VRAM_BYTES, fitsIn, MODELS, modelSubtitle, sortForVram } from "@/lib/models";
import { pullModel, type HealthInfo, type PullProgress } from "@/lib/ollama";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ollamaMissing ? "Install Ollama first" : "Models"}</DialogTitle>
          <DialogDescription>
            {ollamaMissing
              ? "This app talks to Ollama, which runs the models on your graphics card."
              : `${health?.gpu ? `${health.gpu.name} · ${vramGb} GB` : `No NVIDIA GPU detected, assuming ${vramGb} GB`}. Models bigger than your video memory spill into RAM and get slower.`}
          </DialogDescription>
        </DialogHeader>

        {ollamaMissing ? (
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
          <ul className="divide-y-2 divide-ink/20">
            {sortForVram(MODELS, vram).map((m) => {
              const p = progress[m.tag];
              const done = installed.has(m.tag);
              const pct = p?.total ? Math.min(100, Math.round(((p.completed ?? 0) / p.total) * 100)) : null;
              return (
                <li key={m.tag} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {m.label}{" "}
                        <span className="rounded-full border-2 border-ink px-1.5 py-0.5 align-middle text-[10px] font-semibold">
                          {fitsIn(m, vram) ? "fits in GPU" : "spills to RAM"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">{modelSubtitle(m)}</p>
                    </div>
                    {done ? (
                      <Button size="xs" variant="outline" onClick={() => onUse(m.tag)}>
                        <Check /> Use
                      </Button>
                    ) : p ? (
                      <Button size="xs" variant="outline" onClick={() => controllers.current.get(m.tag)?.abort()}>
                        <X /> Cancel
                      </Button>
                    ) : (
                      <Button size="xs" onClick={() => void download(m.tag)} disabled={!health}>
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
                      <p className="text-xs text-muted-foreground">
                        {p.total ? `${gb(p.completed ?? 0)} / ${gb(p.total)} GB` : p.status}
                      </p>
                    </div>
                  )}
                  {errors[m.tag] && <p className="text-xs font-semibold text-destructive">{errors[m.tag]}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
