import type { BackendMode } from "./types";

/** Ollama treats any num_gpu above the layer count as "offload everything". */
export const ALL_LAYERS = 999;

export const BACKEND_LABEL: Record<BackendMode, string> = {
  cpu: "CPU",
  prefill: "Prefill GPU",
  hybrid: "Hybrid",
  gpu: "GPU",
};

/** Default Hybrid split: half the layers, at least one. */
export function halfLayers(layers: number | null): number {
  return layers ? Math.max(1, Math.round(layers / 2)) : 1;
}

/** The num_gpu option for a backend choice. `gpuLayers` null means half the model. */
export function numGpuFor(mode: BackendMode, layers: number | null, gpuLayers: number | null): number {
  if (mode === "cpu" || mode === "prefill") return 0;
  if (mode === "gpu") return ALL_LAYERS;
  const n = gpuLayers ?? halfLayers(layers);
  return layers ? Math.min(Math.max(n, 1), Math.max(layers - 1, 1)) : Math.max(n, 1);
}

/** "CPU", "Hybrid 20 layers", "GPU": what a reply was requested on. */
export function backendText(mode: BackendMode, numGpu: number): string {
  if (mode === "hybrid") return `Hybrid ${numGpu} layers`;
  return BACKEND_LABEL[mode];
}

/** What Ollama says is actually resident: "CPU", "GPU", or "GPU 47%". null = nothing loaded. */
export function placementText(p: { size: number; sizeVram: number } | undefined): string | null {
  if (!p || p.size <= 0) return null;
  const pct = Math.round((p.sizeVram / p.size) * 100);
  if (pct <= 0) return "CPU";
  if (pct >= 100) return "GPU";
  return `GPU ${pct}%`;
}
