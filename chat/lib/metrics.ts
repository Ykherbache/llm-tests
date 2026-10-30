import type { MessageMetrics, OllamaChunk } from "./types";

/** load_duration above this means the weights were (re)loaded for this reply. */
const COLD_START_NS = 1e9;

/**
 * Builds per-message stats from the final `done: true` chunk.
 *
 * Ollama reports every duration in NANOSECONDS:
 *
 *   eval_count     tokens generated (thinking + answer, they share one decode)
 *   eval_duration  time spent generating them, in ns
 *
 *   tok/s = eval_count / (eval_duration / 1e9)
 *
 * e.g. 200 tokens over 4_546_995_000 ns = 200 / 4.547 s = 44.0 tok/s.
 *
 * This is pure decode speed: prompt processing (prompt_eval_duration) and
 * model loading (load_duration) are excluded, so a cold start does not drag
 * the number down. Use total_duration for wall-clock time.
 *
 * prompt_eval_count is the full prompt size in tokens; prompt_eval_cached_count
 * is how many of those were reused from the KV cache of the previous turn.
 */
export function computeMetrics(final: OllamaChunk): MessageMetrics {
  const evalCount = final.eval_count ?? 0;
  const evalNs = final.eval_duration ?? 0;
  const seconds = evalNs / 1e9;
  const loadNs = final.load_duration ?? 0;
  const cachedTokens = final.prompt_eval_cached_count ?? 0;
  return {
    tokensPerSecond: seconds > 0 ? evalCount / seconds : 0,
    evalCount,
    evalDurationMs: evalNs / 1e6,
    promptTokens: final.prompt_eval_count ?? 0,
    promptCachedTokens: cachedTokens,
    cached: cachedTokens > 0,
    loadDurationMs: loadNs / 1e6,
    totalDurationMs: (final.total_duration ?? 0) / 1e6,
    coldStart: loadNs > COLD_START_NS,
    doneReason: final.done_reason ?? "stop",
  };
}

/**
 * Folds the final chunks of several rounds (a tool-calling reply is one model
 * call per round) into one, so computeMetrics() describes the whole reply:
 *
 *   eval_count / eval_duration / total_duration   summed over rounds,
 *                                                 so tok/s = Σ tokens / Σ decode time
 *   load_duration                                 summed (in practice only round 1 loads)
 *   prompt_eval_count                             the LAST round: it is the
 *                                                 biggest prompt and drives the context meter
 *   prompt_eval_cached_count                      max over rounds, so "cached" means
 *                                                 any round reused the KV cache
 *   done_reason                                   the last round's
 */
export function mergeFinal(prev: OllamaChunk | null, next: OllamaChunk): OllamaChunk {
  if (!prev) return next;
  const sum = (k: "eval_count" | "eval_duration" | "total_duration" | "load_duration") =>
    (prev[k] ?? 0) + (next[k] ?? 0);
  return {
    ...next,
    eval_count: sum("eval_count"),
    eval_duration: sum("eval_duration"),
    total_duration: sum("total_duration"),
    load_duration: sum("load_duration"),
    prompt_eval_cached_count: Math.max(prev.prompt_eval_cached_count ?? 0, next.prompt_eval_cached_count ?? 0),
  };
}

export function formatSeconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}
