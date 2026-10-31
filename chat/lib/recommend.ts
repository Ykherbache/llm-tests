import { CPU_ROWS } from "./benchmarks";
import snapshot from "./leaderboards.json";
import { fitFor, type Fit, type MemoryBudget } from "./models";
import { IS_DESKTOP } from "./profile";
import type { BoardId, LbModel, Recommendations, TaskId } from "./types";

export const SNAPSHOT_MODELS = snapshot.models as LbModel[];
export const SNAPSHOT_DATE = snapshot.generatedAt;

export const BOARD_LABEL: Record<BoardId, string> = {
  arena: "LMArena Elo",
  livebench_coding: "LiveBench coding",
  aider: "Aider polyglot %",
  aa_index: "Artificial Analysis index",
};

export const TASK_LABEL: Record<TaskId, string> = { chat: "Chat", coding: "Coding", overall: "Overall" };

/** Boards a task can use, best first. A task ranks on exactly one board, never a mix of scales. */
const TASK_BOARDS: Record<TaskId, BoardId[]> = {
  chat: ["arena"],
  coding: ["livebench_coding", "aider"],
  overall: ["aa_index", "arena"],
};
const MIN_SCORED = 2;

/** Nominal decode tok/s x active billions on an NVIDIA card; nothing was measured there. */
const K_GPU = 800;

export interface Rec {
  model: LbModel;
  board: BoardId;
  quality: number;
  tps: number;
  /** tps is a measured llama-bench decode speed rather than an estimate. */
  measured: boolean;
  fit: Fit;
  tag: string;
  labels: ("Best quality" | "Fastest" | "Balanced")[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Decode tok/s: measured on this machine when available, else a curve fitted to the measured models. */
export function estimateTps(m: LbModel, all: readonly LbModel[] = SNAPSHOT_MODELS): { tps: number; measured: boolean } {
  const bench = (id?: string) => CPU_ROWS.find((r) => r.id === id);
  if (!IS_DESKTOP) {
    const row = bench(m.benchId);
    if (row) return { tps: row.d, measured: true };
    // Decode speed tracks active parameters (see the README), so tok/s x activeB is roughly constant.
    const k = median(all.flatMap((x) => (bench(x.benchId) ? [x.activeB * bench(x.benchId)!.d] : [])));
    return { tps: k / m.activeB, measured: false };
  }
  return { tps: K_GPU / m.activeB, measured: false };
}

/** The board a task ranks on: the first one that scored enough models. */
function boardFor(task: TaskId, models: readonly LbModel[]): BoardId | null {
  return TASK_BOARDS[task].find((b) => models.filter((m) => m.scores[b] !== null).length >= MIN_SCORED) ?? null;
}

export interface Recommendation {
  board: BoardId;
  /** Models no other fitting model beats on both quality and speed. */
  frontier: Rec[];
  /** Fitting models that something else beats on both. */
  others: Rec[];
}

/** The trade-off between quality and speed among the models that fit `budget`, for one task. */
export function recommend(models: readonly LbModel[], task: TaskId, budget: MemoryBudget): Recommendation | null {
  const board = boardFor(task, models);
  if (!board) return null;
  const recs: Rec[] = [];
  for (const model of models) {
    const quality = model.scores[board];
    const tag = IS_DESKTOP ? (model.tags.ollama ?? model.tags.hf) : (model.tags.hf ?? model.tags.ollama);
    const fit = fitFor(model.sizeBytes, budget);
    if (quality === null || !tag || fit === "too-big") continue;
    recs.push({ model, board, quality, ...estimateTps(model, models), fit, tag, labels: [] });
  }
  const beats = (a: Rec, b: Rec) => a.quality >= b.quality && a.tps >= b.tps && (a.quality > b.quality || a.tps > b.tps);
  const frontier = recs.filter((r) => !recs.some((o) => beats(o, r))).sort((a, b) => b.quality - a.quality);
  const others = recs.filter((r) => !frontier.includes(r)).sort((a, b) => b.quality - a.quality);
  if (frontier.length > 0) {
    frontier[0].labels.push("Best quality");
    const fastest = frontier.reduce((a, b) => (b.tps > a.tps ? b : a));
    fastest.labels.push("Fastest");
    if (frontier.length >= 3) {
      const range = (f: (r: Rec) => number) => {
        const v = frontier.map(f);
        return { lo: Math.min(...v), span: Math.max(...v) - Math.min(...v) || 1 };
      };
      const q = range((r) => r.quality);
      const t = range((r) => r.tps);
      const score = (r: Rec) => Math.min((r.quality - q.lo) / q.span, (r.tps - t.lo) / t.span);
      const balanced = frontier.reduce((a, b) => (score(b) > score(a) ? b : a));
      if (balanced.labels.length === 0) balanced.labels.push("Balanced");
    }
  }
  return { board, frontier, others };
}

/** What the dialog shows when /api/recommend cannot be reached: the shipped snapshot, all marked as such. */
export function snapshotRecommendations(): Recommendations {
  const date = SNAPSHOT_DATE;
  const boards = { arena: { live: false, date }, livebench_coding: { live: false, date }, aider: { live: false, date }, aa_index: { live: false, date } };
  return { models: SNAPSHOT_MODELS, boards };
}
