"use client";

import { BACKEND_LABEL, numGpuFor } from "@/lib/backend";
import { IS_DESKTOP } from "@/lib/profile";
import type { BackendMode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  mode: BackendMode;
  gpuLayers: number | null;
  /** Layer count of the active model, null until /api/model answers. */
  layers: number | null;
  /** What Ollama reports as resident ("CPU", "GPU", "GPU 47%"), null when nothing is loaded. */
  placement: string | null;
  /** A GPU run was requested but Ollama kept the model on the CPU. */
  gpuIgnored: boolean;
  disabled: boolean;
  onMode: (m: BackendMode) => void;
  onGpuLayers: (n: number) => void;
}

const MODES: BackendMode[] = IS_DESKTOP ? ["gpu", "hybrid", "cpu"] : ["cpu", "prefill", "hybrid", "gpu"];
const HINT: Record<BackendMode, string> = {
  cpu: IS_DESKTOP
    ? "Every layer runs on the CPU. Much slower than the GPU; only useful to compare."
    : "Every layer runs on the CPU, on a server that has no GPU backend. Prompt reading and answer writing are both CPU.",
  prefill:
    "The model stays in RAM and the CPU writes the answer, but the GPU reads long prompts. Fast prompt reading without using GPU memory.",
  hybrid:
    "The model is a stack of layers. The first N run on the GPU and the rest on the CPU. Every token goes through both halves, for prompt reading and for writing the answer.",
  gpu: "Every layer runs on the GPU.",
};
const ACTIVE: Record<BackendMode, string> = { cpu: "bg-mint", prefill: "bg-marigold", hybrid: "bg-marigold", gpu: "bg-marigold" };

/** CPU | Hybrid | GPU, plus a layer count while Hybrid is selected. */
export function BackendSwitch({ mode, gpuLayers, layers, placement, gpuIgnored, disabled, onMode, onGpuLayers }: Props) {
  const sent = numGpuFor(mode, layers, gpuLayers);
  const max = layers ? Math.max(layers - 1, 1) : 999;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Where the model runs"
        className="inline-flex overflow-hidden rounded-md border-2 border-ink bg-card"
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            title={HINT[m]}
            disabled={disabled}
            onClick={() => onMode(m)}
            className={cn(
              "h-8 px-3 text-sm font-semibold not-first:border-l-2 not-first:border-ink disabled:opacity-50",
              mode === m ? cn(ACTIVE[m], "text-black") : "hover:bg-muted",
            )}
          >
            {BACKEND_LABEL[m]}
          </button>
        ))}
      </div>
      {mode === "hybrid" && (
        <label className="flex items-center gap-1.5 text-sm font-semibold" title={HINT.hybrid}>
          <input
            type="number"
            min={1}
            max={max}
            value={sent}
            disabled={disabled}
            aria-label="Layers on the GPU"
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n)) onGpuLayers(Math.min(Math.max(n, 1), max));
            }}
            className="h-8 w-16 rounded-md border-2 border-ink bg-card px-2 text-sm outline-none focus:shadow-brutal-sm"
          />
          {layers ? `of ${layers} layers` : "layers"}
          {layers && gpuLayers === null && <span className="text-xs font-normal text-muted-foreground">(half)</span>}
        </label>
      )}
      {placement && (
        <span
          className="rounded-full border-2 border-ink bg-card px-2 py-0.5 text-xs font-semibold"
          title="Where Ollama says the loaded model actually is"
        >
          Running on {placement}
        </span>
      )}
      {gpuIgnored && (
        <span className="text-xs font-semibold">Ollama ran the last GPU request on the CPU. Open the status panel (pulse icon) for why.</span>
      )}
    </div>
  );
}
