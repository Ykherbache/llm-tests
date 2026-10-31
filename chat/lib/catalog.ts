import "server-only";
import { parseHTML } from "linkedom";
import type { CatalogHit, CatalogVariant } from "./types";

// Fixed hosts only: the request supplies a search string or a validated name, never a URL.
const OLLAMA = "https://ollama.com";
const HF = "https://huggingface.co";
const TIMEOUT_MS = 8000;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 200;

export const OLLAMA_NAME_RE = /^[a-z0-9][\w.-]{0,80}$/;
export const HF_REPO_RE = /^[\w.-]{1,96}\/[\w.-]{1,96}$/;

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function get(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "local-chat" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
  return res;
}

const BYTES: Record<string, number> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** "5.2GB" -> bytes, null when there is no size. */
function parseSize(text: string): number | null {
  const m = /([\d.]+)\s*(KB|MB|GB|TB)\b/i.exec(text);
  return m ? Math.round(parseFloat(m[1]) * BYTES[m[2].toUpperCase()]) : null;
}

export function searchOllama(q: string): Promise<CatalogHit[]> {
  return cached(`ollama:${q.toLowerCase()}`, async () => {
    const html = await (await get(`${OLLAMA}/search?q=${encodeURIComponent(q)}`, "text/html")).text();
    const { document } = parseHTML(html);
    const hits: CatalogHit[] = [];
    for (const a of Array.from(document.querySelectorAll('li a[href^="/library/"]'))) {
      const name = a.getAttribute("href")?.slice("/library/".length) ?? "";
      if (!OLLAMA_NAME_RE.test(name)) continue;
      // Chip colours tell the kinds apart: indigo = capability, light blue = parameter size.
      const chips = (tone: string) =>
        Array.from(a.querySelectorAll("span"))
          .filter((s) => (s.getAttribute("class") ?? "").includes(tone))
          .map((s) => (s.textContent ?? "").trim())
          .filter(Boolean);
      const downloads = Array.from(a.querySelectorAll("span[title]"))
        .map((s) => /^([\d,]+) downloads$/.exec(s.getAttribute("title") ?? ""))
        .find(Boolean);
      hits.push({
        source: "ollama",
        name,
        description: a.querySelector("p")?.textContent?.trim() || undefined,
        capabilities: chips("indigo"),
        sizes: chips("ddf4ff"),
        downloads: downloads ? Number(downloads[1].replace(/,/g, "")) : undefined,
      });
    }
    return hits;
  });
}

export function ollamaVariants(name: string): Promise<CatalogVariant[]> {
  return cached(`ollama-tags:${name}`, async () => {
    const html = await (await get(`${OLLAMA}/library/${name}/tags`, "text/html")).text();
    const { document } = parseHTML(html);
    const found = new Map<string, CatalogVariant>();
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith(`/library/${name}:`)) continue;
      const tag = href.slice("/library/".length);
      if (found.has(tag)) continue;
      // The mobile row carries "digest • 5.2GB • 40K context window"; the desktop one is just the name.
      const text = (a.textContent ?? "").replace(/\s+/g, " ");
      const sizeBytes = parseSize(text);
      if (sizeBytes === null) continue; // cloud tags have no download
      const ctx = /(\d+[KM]) context window/.exec(text);
      found.set(tag, { tag, sizeBytes, note: ctx ? `${ctx[1]} context` : undefined });
    }
    return [...found.values()];
  });
}

export function searchHf(q: string): Promise<CatalogHit[]> {
  return cached(`hf:${q.toLowerCase()}`, async () => {
    const url = `${HF}/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&limit=20`;
    const rows = (await (await get(url, "application/json")).json()) as { id?: string; downloads?: number }[];
    return rows
      .filter((r): r is { id: string; downloads?: number } => typeof r.id === "string" && HF_REPO_RE.test(r.id))
      .map((r) => ({ source: "hf" as const, name: r.id, downloads: r.downloads }));
  });
}

const QUANT_RE = /((?:UD-)?(?:I?Q\d\w*|BF16|F16|F32))(?=\.gguf$|-\d{5}-of-\d{5}\.gguf$)/i;

export function hfVariants(repo: string): Promise<CatalogVariant[]> {
  return cached(`hf-tree:${repo}`, async () => {
    const files = (await (await get(`${HF}/api/models/${repo}/tree/main?recursive=true`, "application/json")).json()) as {
      type?: string;
      path?: string;
      size?: number;
    }[];
    // Split GGUFs (-00001-of-00003) are one download: add the shards together.
    const quants = new Map<string, number>();
    for (const f of files) {
      const path = f.path ?? "";
      if (f.type !== "file" || !path.toLowerCase().endsWith(".gguf") || /mmproj/i.test(path)) continue;
      const quant = QUANT_RE.exec(path.split("/").pop() ?? "")?.[1];
      if (!quant || !f.size) continue;
      quants.set(quant, (quants.get(quant) ?? 0) + f.size);
    }
    return [...quants].map(([quant, sizeBytes]) => ({ tag: `hf.co/${repo}:${quant}`, sizeBytes }));
  });
}
