import "server-only";
import { SNAPSHOT_DATE, SNAPSHOT_MODELS } from "./recommend";
import type { BoardId, LbModel, Recommendations } from "./types";

// Fixed hosts only; nothing from the request reaches these URLs.
const TIMEOUT_MS = 8000;
const CACHE_MS = 6 * 3600_000;

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

type Rows = { name: string; score: number }[];

async function getText(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "local-chat", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
  return res.text();
}

/** LMArena's text leaderboard, open-licence models only, from its official Hugging Face dataset. */
async function arena(): Promise<Rows> {
  const pages = await Promise.all(
    [0, 100, 200, 300, 400, 500].map((offset) =>
      getText(`https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest&offset=${offset}&length=100`),
    ),
  );
  return pages.flatMap((p) =>
    (JSON.parse(p).rows as { row: { model_name: string; rating: number; category: string } }[])
      // The dataset repeats every model once per category; only "overall" is comparable.
      .filter((r) => r.row.category === "overall")
      .map((r) => ({ name: r.row.model_name, score: Math.round(r.row.rating) })),
  );
}

/** Aider polyglot pass rate, from the leaderboard's data file in its repository. */
async function aider(): Promise<Rows> {
  const yml = await getText("https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml");
  const out: Rows = [];
  let model: string | null = null;
  for (const line of yml.split("\n")) {
    const m = /^\s+model: (.+)$/.exec(line);
    if (m) model = m[1].trim();
    const p = /^\s+pass_rate_2: ([\d.]+)/.exec(line);
    if (p && model) out.push({ name: model, score: parseFloat(p[1]) });
  }
  return out;
}

/** Artificial Analysis needs a key; without one this board simply stays on the snapshot. */
async function artificialAnalysis(): Promise<Rows> {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!key) throw new Error("no ARTIFICIAL_ANALYSIS_API_KEY");
  const body = JSON.parse(await getText("https://artificialanalysis.ai/api/v2/data/llms/models", { "x-api-key": key })) as {
    data?: { name: string; evaluations?: { artificial_analysis_intelligence_index?: number } }[];
  };
  return (body.data ?? []).flatMap((m) =>
    typeof m.evaluations?.artificial_analysis_intelligence_index === "number"
      ? [{ name: m.name, score: m.evaluations.artificial_analysis_intelligence_index }]
      : [],
  );
}

// LiveBench is not fetched here: its data file name is only discoverable from its JS bundle.
// scripts/refresh-leaderboards.mjs reads it into the snapshot.
const LIVE: Partial<Record<BoardId, () => Promise<Rows>>> = { arena, aider, aa_index: artificialAnalysis };

let cache: { at: number; value: Recommendations } | null = null;

/** The snapshot with live scores laid over it; a board whose fetch fails keeps its snapshot scores. */
export async function leaderboards(): Promise<Recommendations> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const boards = Object.fromEntries(
    (["arena", "livebench_coding", "aider", "aa_index"] as BoardId[]).map((b) => [b, { live: false, date: SNAPSHOT_DATE }]),
  ) as Recommendations["boards"];
  const models: LbModel[] = SNAPSHOT_MODELS.map((m) => ({ ...m, scores: { ...m.scores }, live: [] }));
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all(
    (Object.entries(LIVE) as [BoardId, () => Promise<Rows>][]).map(async ([board, load]) => {
      let rows: Rows;
      try {
        rows = await load();
      } catch {
        return;
      }
      const byName = new Map(rows.map((r) => [norm(r.name), r.score]));
      for (const m of models) {
        const hit = m.names.map((n) => byName.get(norm(n))).find((s) => s !== undefined);
        if (hit !== undefined) {
          m.scores[board] = hit;
          m.live!.push(board);
        }
      }
      boards[board] = { live: true, date: today };
    }),
  );
  const value = { models, boards };
  // A fully offline result is not cached, so the next open tries again.
  if (Object.values(boards).some((b) => b.live)) cache = { at: Date.now(), value };
  return value;
}
