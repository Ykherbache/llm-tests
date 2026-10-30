// Numbers from ../results/gpu-vs-cpu-2026-10-30.md (llama-bench, M1 Pro, Asahi).
// tok/s unless noted. `p` = prefill (pp512), `d` = decode (tg128), `*8k` = with an
// 8192-token prefix already in the context. null = not measured.

export interface CpuRow {
  id: string;
  name: string;
  alias?: string;
  sizeGiB: number;
  p: number;
  d: number;
  p8k: number | null;
  d8k: number | null;
}

export const CPU_ROWS: CpuRow[] = [
  { id: "LFM24", name: "LFM2.5-24B-A2B", alias: "local-lfm24-t6", sizeGiB: 13.85, p: 118.3, d: 46.2, p8k: 73.6, d8k: 31.0 },
  { id: "CODER", name: "Qwen3-Coder-30B-A3B", alias: "local-coder-t6", sizeGiB: 17.28, p: 85.5, d: 37.8, p8k: 17.9, d8k: 8.3 },
  { id: "NEMO30", name: "Nemotron 30B-A3B (Q3)", sizeGiB: 19.77, p: 119.4, d: 28.4, p8k: 72.3, d8k: 21.3 },
  { id: "QWEN35", name: "Qwen3.5-35B-A3B", sizeGiB: 19.24, p: 127.4, d: 24.9, p8k: 54.9, d8k: 18.6 },
  { id: "BIG", name: "Qwen3.6-35B-A3B", sizeGiB: 20.6, p: 110.1, d: 24.3, p8k: 51.6, d8k: 17.9 },
  { id: "MOE26", name: "Gemma 4 26B-A4B", alias: "local-moe26-t6", sizeGiB: 15.77, p: 82.3, d: 21.8, p8k: 39.2, d8k: 11.3 },
  { id: "DENSE", name: "Qwen3.8-27B dense (Q4_K_M)", sizeGiB: 15.32, p: 10.7, d: 4.9, p8k: null, d8k: null },
  { id: "DENSE_IQ4", name: "Qwen3.8-27B dense (IQ4_XS)", sizeGiB: 13.26, p: 5.7, d: 4.0, p8k: null, d8k: null },
  { id: "DENSE_Q3", name: "Qwen3.8-27B dense (Q3_K_XL)", sizeGiB: 12.23, p: 4.0, d: 3.2, p8k: null, d8k: null },
];

export interface GpuRow {
  id: string;
  name: string;
  cpu: { p: number; d: number; p8k: number | null; d8k: number | null };
  gpu: { p: number; d: number; p8k: number | null; d8k: number | null };
}

// Only these two models were measured on the GPU.
export const GPU_ROWS: GpuRow[] = [
  {
    id: "LFM24",
    name: "LFM2.5-24B-A2B",
    cpu: { p: 118.3, d: 46.2, p8k: 73.6, d8k: 31.0 },
    gpu: { p: 145.7, d: 28.5, p8k: 118.5, d8k: 25.9 },
  },
  {
    id: "DENSE_Q3",
    name: "Qwen3.8-27B dense (Q3_K_XL)",
    cpu: { p: 4.0, d: 3.2, p8k: null, d8k: null },
    gpu: { p: 20.1, d: 0.73, p8k: 16.4, d8k: null },
  },
];

/** "+23%", "-38%", or "5.0x" once the change is 2x or more in either direction. */
export function formatChange(cpu: number | null, gpu: number | null): { text: string; better: boolean } | null {
  if (cpu === null || gpu === null) return null;
  const r = gpu / cpu;
  const better = r >= 1;
  if (r >= 2) return { text: `${r.toFixed(1)}x faster`, better };
  if (r <= 0.5) return { text: `${(1 / r).toFixed(1)}x slower`, better };
  const pct = Math.round((r - 1) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, better };
}

// Desktop lag: seconds for `vkcube --c 300` while a GPU llama-bench ran on the dense Q3 model.
export const LAG_IDLE_S = 2.66;
export const LAG_MAX_S = 70;

export interface LagRow {
  label: string;
  detail: string;
  probes: number[]; // seconds per 300 frames, in the order taken
  prefill: number; // tok/s of the benchmark itself
}

export const LAG_ROWS: LagRow[] = [
  { label: "Default", detail: "no tuning", probes: [65.65, 4.64], prefill: 19.9 },
  { label: "Smaller submissions", detail: "GGML_VK_MAX_NODES_PER_SUBMIT=8", probes: [34.62, 14.79, 6.86], prefill: 19.9 },
  { label: "Smaller batches", detail: "-ub 64", probes: [38.29, 32.91, 8.71], prefill: 16.7 },
  { label: "Both", detail: "submissions 8 + -ub 64", probes: [17.48, 41.03, 14.47], prefill: 16.7 },
];

export interface Pick {
  use: string;
  model: string;
  id: string;
  headline: string;
  why: string;
}

export const PICKS: Pick[] = [
  {
    use: "Chat",
    model: "LFM2.5-24B-A2B",
    id: "LFM24",
    headline: "46 tok/s",
    why: "Fastest decode by a wide margin, and still 31 tok/s with 8k tokens of context.",
  },
  {
    use: "Coding, short prompts",
    model: "Qwen3-Coder-30B-A3B",
    id: "CODER",
    headline: "38 tok/s",
    why: "A dedicated coder at good speed, as long as the prompt stays short.",
  },
  {
    use: "Coding, whole files",
    model: "Qwen3.6-35B-A3B",
    id: "BIG",
    headline: "18 tok/s at 8k",
    why: "The coder falls to 8 tok/s at 8k; this one keeps 18 and prefills at 52.",
  },
  {
    use: "Long context",
    model: "Nemotron 30B-A3B (Q3)",
    id: "NEMO30",
    headline: "21 tok/s at 8k",
    why: "Best on every 8k measure: 21 tok/s decode, 72 tok/s prefill. A Q3 quant, so check quality.",
  },
];
