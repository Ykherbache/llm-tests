// Rebuilds lib/leaderboards.json: scores from LMArena, LiveBench and Aider (Artificial Analysis when
// ARTIFICIAL_ANALYSIS_API_KEY is set), plus a proposed download tag for each model.
//
//   node scripts/refresh-leaderboards.mjs
//
// Review `git diff lib/leaderboards.json` before committing. Mappings already in the file are kept
// (hand-fixed tags survive); only scores and generatedAt are overwritten. New models are added with
// "verified": false and only if a tag could be found, since the app hides models it cannot download.
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../lib/leaderboards.json", import.meta.url);
const MIN_ARENA = 1300; // older, weaker models are not worth recommending
const MAX_GB = 40; // anything bigger cannot fit any machine this app targets
const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, "");

async function get(url, init) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": "local-chat", ...init?.headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}
const attempt = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    console.warn(`! ${label}: ${e.message}`);
    return null;
  }
};

// "Gemma 4 26B A4B", "Qwen3.5-35B-A3B", "Qwen3.8-27B" -> { totalB, activeB }
function paramsOf(name) {
  const total = /(?:^|[^\w.])(\d+(?:\.\d+)?)B(?![a-z])/i.exec(name);
  const active = /[-\s]A(\d+(?:\.\d+)?)B/i.exec(name);
  if (!total) return null;
  return { totalB: parseFloat(total[1]), activeB: active ? parseFloat(active[1]) : parseFloat(total[1]) };
}

async function arena() {
  const rows = [];
  for (let offset = 0; offset < 600; offset += 100) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest&offset=${offset}&length=100`;
    const body = await (await get(url)).json();
    rows.push(...body.rows.map((r) => r.row));
    if (body.rows.length < 100) break;
  }
  // The dataset repeats every model once per category (chinese, coding, ...); only "overall" is comparable.
  return rows.filter((r) => r.category === "overall" && !/proprietary/i.test(r.license ?? "")).map((r) => ({ name: r.model_name, score: Math.round(r.rating) }));
}

async function liveBench() {
  const home = await (await get("https://livebench.ai/")).text();
  const bundle = /static\/js\/main[^"]+\.js/.exec(home)?.[0];
  if (!bundle) throw new Error("bundle not found");
  const js = await (await get(`https://livebench.ai/${bundle}`)).text();
  const dates = [...new Set([...js.matchAll(/20\d\d[-_]\d\d[-_]\d\d/g)].map((m) => m[0].replaceAll("-", "_")))].sort().reverse();
  for (const d of dates) {
    const res = await fetch(`https://livebench.ai/v1/table_${d}.csv`).catch(() => null);
    if (!res?.ok) continue;
    const [head, ...lines] = (await res.text()).trim().split("\n");
    const cols = head.split(",");
    const idx = ["code_generation", "code_completion"].map((c) => cols.indexOf(c));
    return lines.map((l) => {
      const f = l.split(",");
      const v = idx.map((i) => parseFloat(f[i])).filter(Number.isFinite);
      return { name: f[0], score: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null };
    });
  }
  throw new Error("no table csv found");
}

async function aider() {
  const yml = await (await get("https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml")).text();
  const out = [];
  let model = null;
  for (const line of yml.split("\n")) {
    const m = /^\s+model: (.+)$/.exec(line);
    if (m) model = m[1].trim();
    const p = /^\s+pass_rate_2: ([\d.]+)/.exec(line);
    if (p && model) out.push({ name: model, score: parseFloat(p[1]) });
  }
  return out;
}

async function artificialAnalysis() {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!key) return null;
  const body = await (await get("https://artificialanalysis.ai/api/v2/data/llms/models", { headers: { "x-api-key": key } })).json();
  return (body.data ?? []).map((m) => ({ name: m.name, score: m.evaluations?.artificial_analysis_intelligence_index ?? null }));
}

// ---- tag proposals -------------------------------------------------------------------------
const QUANT_PREF = ["UD-Q4_K_XL", "UD-Q4_K_M", "Q4_K_M", "Q4_K_S", "IQ4_XS"];
const QUANT_RE = /((?:UD-)?(?:I?Q\d\w*|BF16|F16|F32))(?=\.gguf$|-\d{5}-of-\d{5}\.gguf$)/i;

async function proposeHf(name) {
  const strip = (s) => norm(s).replace(/gguf|instruct|chat|it$/g, "");
  const rows = await (await get(`https://huggingface.co/api/models?search=${encodeURIComponent(name + " GGUF")}&filter=gguf&sort=downloads&limit=10`)).json();
  // The repo name must be the model's own name, not a fine-tune or merge that merely contains it.
  const repo = rows.find((r) => strip(r.id.split("/")[1]) === strip(name));
  if (!repo) return null;
  const files = await (await get(`https://huggingface.co/api/models/${repo.id}/tree/main?recursive=true`)).json();
  const quants = new Map();
  for (const f of files) {
    const p = f.path ?? "";
    if (f.type !== "file" || !p.toLowerCase().endsWith(".gguf") || /mmproj/i.test(p)) continue;
    const q = QUANT_RE.exec(p.split("/").pop())?.[1];
    if (q && f.size) quants.set(q, (quants.get(q) ?? 0) + f.size);
  }
  const quant = QUANT_PREF.find((q) => [...quants.keys()].some((k) => k.toLowerCase() === q.toLowerCase()));
  if (!quant) return null;
  const real = [...quants.keys()].find((k) => k.toLowerCase() === quant.toLowerCase());
  return { tag: `hf.co/${repo.id}:${real}`, sizeBytes: quants.get(real) };
}

// ---- main ----------------------------------------------------------------------------------
const existing = JSON.parse(readFileSync(OUT, "utf8"));
const byId = new Map(existing.models.map((m) => [m.id, m]));

const [arenaRows, lbRows, aiderRows, aaRows] = await Promise.all([
  attempt("LMArena", arena),
  attempt("LiveBench", liveBench),
  attempt("Aider", aider),
  attempt("Artificial Analysis", artificialAnalysis),
]);

const scoreFor = (rows, names) => {
  const want = new Set(names.map(norm));
  return rows?.find((r) => r.score !== null && want.has(norm(r.name)))?.score ?? null;
};

// Existing entries: refresh scores. New open-weight models from the Arena that fit: propose a tag.
for (const row of arenaRows ?? []) {
  const p = paramsOf(row.name);
  if (!p || row.score < MIN_ARENA || (p.totalB * 0.6) > MAX_GB) continue; // ~0.6 GB per billion params at Q4
  const id = norm(row.name);
  if (byId.has(id) || existing.models.some((m) => m.names.some((n) => norm(n) === id))) continue;
  const hf = await attempt(`tag for ${row.name}`, () => proposeHf(row.name));
  if (!hf) continue;
  byId.set(id, { id, names: [row.name], ...p, tags: { hf: hf.tag }, sizeBytes: hf.sizeBytes, verified: false, scores: {} });
  console.log(`+ ${row.name} -> ${hf.tag}`);
}

for (const m of byId.values()) {
  const keep = (key, rows) => scoreFor(rows, m.names) ?? m.scores?.[key] ?? null;
  m.scores = {
    arena: keep("arena", arenaRows),
    livebench_coding: keep("livebench_coding", lbRows),
    aider: keep("aider", aiderRows),
    aa_index: keep("aa_index", aaRows),
  };
}

const models = [...byId.values()].filter((m) => Object.values(m.scores).some((s) => s !== null));
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), models }, null, 2) + "\n");
console.log(`wrote ${models.length} models (${models.filter((m) => m.verified === false).length} unverified)`);
