import { IS_DESKTOP } from "./profile";

export interface ModelInfo {
  tag: string;
  label: string;
  params: string;
  size: string;
  expectedTps: number;
  /** models.env key, for the recreate-alias hint. */
  registryKey: string;
  /** The Hugging Face weights the alias points at. */
  baseRef: string;
}

// Local aliases created by ../setup.sh --threads 6 --alias KEY.
// num_thread is baked into each alias; never send it from the app.
const ASAHI_MODELS: readonly ModelInfo[] = [
  {
    tag: "local-lfm24-t6",
    label: "LFM 2.5 24B",
    params: "24B MoE, 2B active",
    size: "14.9 GB",
    expectedTps: 40,
    registryKey: "LFM24",
    baseRef: "hf.co/unsloth/LFM2.5-24B-A2B-GGUF:UD-Q4_K_XL",
  },
  {
    tag: "local-coder-t6",
    label: "Qwen3 Coder 30B",
    params: "30B MoE, 3.3B active",
    size: "18.6 GB",
    expectedTps: 29,
    registryKey: "CODER",
    baseRef: "hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M",
  },
  {
    tag: "local-moe26-t6",
    label: "Gemma 4 26B",
    params: "26B MoE, 4B active",
    size: "17.0 GB",
    expectedTps: 19,
    registryKey: "MOE26",
    baseRef: "hf.co/unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_M",
  },
];

/**
 * Every model in ../models.env, so any of them can be tried by hand. `tag` is the
 * raw Ollama reference (what `ollama pull` creates); the three aliases above
 * point at the same weights. expectedTps is the CPU decode speed measured with
 * llama-bench (lib/benchmarks.ts), 0 where nothing was measured.
 */
const hf = (repo: string, quant: string) => `hf.co/${repo}:${quant}`;
const ASAHI_RAW: readonly ModelInfo[] = [
  { tag: hf("unsloth/Qwen3.5-35B-A3B-GGUF", "Q4_K_S"), label: "Qwen3.5 35B", params: "35B MoE, 3B active", size: "20.7 GB", expectedTps: 25, registryKey: "QWEN35", baseRef: hf("unsloth/Qwen3.5-35B-A3B-GGUF", "Q4_K_S") },
  { tag: hf("unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF", "UD-Q3_K_XL"), label: "Nemotron 30B (Q3)", params: "30B hybrid MoE, 3B active", size: "21.2 GB", expectedTps: 28, registryKey: "NEMO30", baseRef: hf("unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF", "UD-Q3_K_XL") },
  { tag: hf("mradermacher/Qwen3.5-9B-Coder-GGUF", "Q4_K_M"), label: "Qwen3.5 9B Coder", params: "9B dense", size: "5.8 GB", expectedTps: 0, registryKey: "CODER_S", baseRef: hf("mradermacher/Qwen3.5-9B-Coder-GGUF", "Q4_K_M") },
  { tag: hf("unsloth/Qwen3.5-4B-GGUF", "Q4_K_M"), label: "Qwen3.5 4B", params: "4B dense", size: "2.7 GB", expectedTps: 0, registryKey: "TINY4", baseRef: hf("unsloth/Qwen3.5-4B-GGUF", "Q4_K_M") },
  { tag: hf("unsloth/Qwen3.8-27B-GGUF", "UD-Q4_K_M"), label: "Qwen3.8 27B (Q4_K_M)", params: "27B dense", size: "16.5 GB", expectedTps: 5, registryKey: "DENSE", baseRef: hf("unsloth/Qwen3.8-27B-GGUF", "UD-Q4_K_M") },
  { tag: hf("unsloth/Qwen3.8-27B-GGUF", "UD-IQ4_XS"), label: "Qwen3.8 27B (IQ4_XS)", params: "27B dense", size: "14.3 GB", expectedTps: 4, registryKey: "DENSE_IQ4", baseRef: hf("unsloth/Qwen3.8-27B-GGUF", "UD-IQ4_XS") },
  { tag: hf("unsloth/Qwen3.8-27B-GGUF", "UD-Q3_K_XL"), label: "Qwen3.8 27B (Q3_K_XL)", params: "27B dense", size: "13.2 GB", expectedTps: 3, registryKey: "DENSE_Q3", baseRef: hf("unsloth/Qwen3.8-27B-GGUF", "UD-Q3_K_XL") },
  { tag: hf("unsloth/Qwen3.6-35B-A3B-GGUF", "UD-Q4_K_M"), label: "Qwen3.6 35B", params: "35B MoE, 3B active", size: "22.1 GB", expectedTps: 24, registryKey: "BIG", baseRef: hf("unsloth/Qwen3.6-35B-A3B-GGUF", "UD-Q4_K_M") },
];

/**
 * Desktop profile: raw Hugging Face refs on a 16 GB NVIDIA card. No aliases (num_thread
 * means nothing on a GPU) and no tok/s claims, since nothing was measured on that hardware.
 * `size` is the weight file; the KV cache comes on top, so ~13 GB is the practical ceiling.
 */
const DESKTOP_MODELS: readonly ModelInfo[] = [
  { tag: hf("unsloth/Qwen3.5-4B-GGUF", "Q4_K_M"), label: "Qwen3.5 4B", params: "4B dense", size: "2.7 GB", expectedTps: 0, registryKey: "TINY4", baseRef: hf("unsloth/Qwen3.5-4B-GGUF", "Q4_K_M") },
  { tag: hf("mradermacher/Qwen3.5-9B-Coder-GGUF", "Q4_K_M"), label: "Qwen3.5 9B Coder", params: "9B dense", size: "5.8 GB", expectedTps: 0, registryKey: "CODER_S", baseRef: hf("mradermacher/Qwen3.5-9B-Coder-GGUF", "Q4_K_M") },
  { tag: hf("unsloth/Qwen3.8-27B-GGUF", "UD-Q3_K_XL"), label: "Qwen3.8 27B (Q3_K_XL)", params: "27B dense", size: "13.2 GB", expectedTps: 0, registryKey: "DENSE_Q3", baseRef: hf("unsloth/Qwen3.8-27B-GGUF", "UD-Q3_K_XL") },
  { tag: hf("unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF", "Q4_K_M"), label: "Qwen3 Coder 30B (spills to RAM)", params: "30B MoE, 3.3B active", size: "18.6 GB", expectedTps: 0, registryKey: "CODER", baseRef: hf("unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF", "Q4_K_M") },
  { tag: hf("unsloth/gemma-4-26B-A4B-it-GGUF", "UD-Q4_K_M"), label: "Gemma 4 26B (spills to RAM)", params: "26B MoE, 4B active", size: "17.0 GB", expectedTps: 0, registryKey: "MOE26", baseRef: hf("unsloth/gemma-4-26B-A4B-it-GGUF", "UD-Q4_K_M") },
];

/** Models worth offering first. Pull-able from the picker. */
export const MODELS: readonly ModelInfo[] = IS_DESKTOP ? DESKTOP_MODELS : ASAHI_MODELS;
const RAW: readonly ModelInfo[] = IS_DESKTOP ? [] : ASAHI_RAW;

export const DEFAULT_MODEL = MODELS[IS_DESKTOP ? 1 : 0].tag;
/** Ollama model references: letters, digits and . _ - / : only. */
export const TAG_RE = /^[\w.\-/:]{1,200}$/;
export const CONTEXT_WINDOW = 16384;
export const DEFAULT_TEMPERATURE = 0.7;
// Per model call. Thinking counts toward it, and with web tools the final
// answer comes after pages of reasoning, so 2048 cut answers off in testing.
export const DEFAULT_MAX_TOKENS = 4096;
export const KEEP_ALIVE = "15m";

/** Looks a model up by its alias tag or by the Hugging Face ref it was pulled from. */
export function modelInfo(tag: string): ModelInfo | undefined {
  return [...MODELS, ...RAW].find((m) => m.tag === tag || m.baseRef === tag);
}

/** The thread-capped aliases carry num_thread in their Modelfile (`-t6`, `-t8`...). */
export function isThreadCapped(tag: string): boolean {
  return /-t\d+$/.test(tag);
}

export function modelLabel(tag: string): string {
  return modelInfo(tag)?.label ?? tag;
}

export function modelSubtitle(m: ModelInfo): string {
  return m.expectedTps > 0 ? `${m.params} · ${m.size} · ~${m.expectedTps} tok/s` : `${m.params} · ${m.size}`;
}

/** Subtitle for a model the app has no entry for, from what Ollama reports about it. */
export function installedSubtitle(m: { sizeBytes: number; paramSize: string; quant: string }): string {
  const gb = m.sizeBytes > 0 ? `${(m.sizeBytes / 1e9).toFixed(1)} GB` : "";
  return [m.paramSize, m.quant, gb].filter(Boolean).join(" · ");
}

/** Ollama reports "name:latest"; our tags omit the suffix. */
export function normalizeTag(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}
