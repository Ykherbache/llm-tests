import "server-only";
import { execFile } from "node:child_process";
import { parseHTML } from "linkedom";
import path from "node:path";
import { fetchPage } from "./fetchPage";
import { IS_DESKTOP } from "./profile";
import { SEARXNG_URL } from "./server";
import { SEARCH_RESULTS, type SearchHit, type ToolResult } from "./tools";

/**
 * Asahi: SearXNG answers its own /healthz; anything else means search is off.
 * Desktop: search is the built-in DuckDuckGo provider, so it is always on.
 */
export async function searchUp(): Promise<boolean> {
  if (IS_DESKTOP) return true;
  try {
    const res = await fetch(`${SEARXNG_URL}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

let starting: Promise<{ up: boolean; message?: string }> | null = null;

/**
 * Runs scripts/searxng.sh (a fixed script, no input from the request) and waits
 * for SearXNG to answer. Concurrent calls share one run.
 */
export function startSearxng(): Promise<{ up: boolean; message?: string }> {
  if (IS_DESKTOP) return Promise.resolve({ up: true });
  starting ??= (async () => {
    if (await searchUp()) return { up: true };
    const script = path.join(process.cwd(), "scripts", "searxng.sh");
    const failure = await new Promise<string | null>((resolve) => {
      execFile("bash", [script], { timeout: 60_000 }, (err, _out, stderr) => {
        resolve(err ? (stderr.trim().split("\n").pop() || err.message) : null);
      });
    });
    if (failure) return { up: false, message: `Could not start SearXNG: ${failure}` };
    for (let i = 0; i < 20; i++) {
      if (await searchUp()) return { up: true };
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { up: false, message: "SearXNG was started but isn't answering yet. Try again in a few seconds." };
  })().finally(() => {
    starting = null;
  });
  return starting;
}

interface RawHit {
  title?: string;
  url?: string;
  content?: string;
}

/** DuckDuckGo's HTML endpoint wraps result links as //duckduckgo.com/l/?uddg=<encoded target>. */
function unwrapDdg(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    return u.searchParams.get("uddg") ?? u.href;
  } catch {
    return href;
  }
}

/** No-key search for the desktop build: scrapes html.duckduckgo.com (no JavaScript needed). */
async function ddgResults(q: string, signal: AbortSignal): Promise<RawHit[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (local-chat web_search)" },
    body: new URLSearchParams({ q }),
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  const { document } = parseHTML(await res.text());
  return [...document.querySelectorAll(".result")].flatMap((el): RawHit[] => {
    const a = el.querySelector("a.result__a");
    const href = a?.getAttribute("href");
    if (!a || !href) return [];
    return [{ title: a.textContent ?? "", url: unwrapDdg(href), content: el.querySelector(".result__snippet")?.textContent ?? "" }];
  });
}

async function searxResults(q: string, signal: AbortSignal): Promise<RawHit[]> {
  const url = `${SEARXNG_URL}/search?${new URLSearchParams({ q, format: "json" })}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`SearXNG returned HTTP ${res.status}`);
  return ((await res.json()) as SearxResponse).results ?? [];
}

interface SearxResponse {
  results?: { title?: string; url?: string; content?: string }[];
  answers?: unknown[];
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** How many of the top results are tried when looking for one that can be read. */
const PAGE_ATTEMPTS = 3;

/**
 * `pageChars` > 0 also reads the first result that can be fetched (a 403 or a
 * timeout moves on to the next), so the model often needs no fetch_url round.
 */
export async function webSearch(query: string, signal: AbortSignal, pageChars = 0): Promise<ToolResult> {
  const q = query.trim();
  if (!q) return { content: "Error: empty query", error: "Empty query" };

  const results = await (IS_DESKTOP ? ddgResults(q, signal) : searxResults(q, signal));

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const r of results) {
    // Engines pass URLs through as-is; only http(s) links reach the model and the UI.
    if (!r.url || !/^https?:\/\//i.test(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    hits.push({ title: clip(r.title ?? r.url, 120), url: r.url, snippet: clip(r.content ?? "", 300) });
    if (hits.length === SEARCH_RESULTS) break;
  }

  if (hits.length === 0) return { content: `No results for "${q}".`, hits };
  const content = hits
    .map((h, i) => `[${i + 1}] ${h.title}\nURL: ${h.url}\n${h.snippet}`)
    .join("\n\n");
  const result: ToolResult = { content: `Search results for "${q}":\n\n${content}`, hits };
  for (let i = 0; pageChars > 0 && i < Math.min(hits.length, PAGE_ATTEMPTS); i++) {
    try {
      const read = await fetchPage(hits[i].url, signal, pageChars);
      if (read.error) continue;
      return { ...result, content: `${result.content}\n\nText of result [${i + 1}]:\n${read.content}`, page: read.page };
    } catch {
      if (signal.aborted) break;
    }
  }
  return result;
}
