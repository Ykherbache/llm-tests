import { TOOL_NAMES } from "./tools";
import type { ToolCall } from "./types";

// Some models (LFM 2.5) write their tool calls as text in their own format:
//   <|tool_call_start|>[web_search(query='météo Paris')]<|tool_call_end|>
// When the Ollama alias has no tool parser, that text reaches the app instead of
// a structured tool_calls field. These helpers hide it while it streams and turn
// it back into tool calls, so tools work whichever server answers.
//
// The same models also drift into a JSON object, bare or in a markdown fence:
//   ```json
//   { "tool": "web_search", "query": "météo Paris" }
//   ```
// Those count as calls only when they name one of our tools.

export const CALL_START = "<|tool_call_start|>";
export const CALL_END = "<|tool_call_end|>";

/** Where a start marker is, or starts to arrive (`<|tool_ca`); text.length if nowhere. */
function markerCut(text: string): number {
  const at = text.indexOf(CALL_START);
  if (at >= 0) return at;
  for (let k = Math.min(CALL_START.length - 1, text.length); k > 0; k--) {
    if (text.endsWith(CALL_START.slice(0, k))) return text.length - k;
  }
  return text.length;
}

/**
 * The part of a streaming text that is safe to show: everything before the first
 * text-format call, and nothing of one that is still arriving.
 */
export function visibleText(text: string): string {
  return text.slice(0, Math.min(markerCut(text), looseHits(text)[0]?.start ?? text.length));
}

type Args = Record<string, unknown>;

function coerce(raw: string): unknown {
  const v = raw.trim();
  if (v === "true" || v === "True") return true;
  if (v === "false" || v === "False") return false;
  if (v === "null" || v === "None") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

const NEXT_ARG_OR_END = /^\s*(,\s*[A-Za-z_]\w*\s*=|\))/;

/** Parses `a='x', b=2` from `i` up to the call's closing paren. */
function parseArgs(s: string, i: number): { args: Args; end: number } | null {
  const args: Args = {};
  for (;;) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (s[i] === ")") return { args, end: i + 1 };
    const key = /^([A-Za-z_]\w*)\s*=\s*/.exec(s.slice(i));
    if (!key) return null;
    i += key[0].length;
    const quote = s[i];
    if (quote === "'" || quote === '"') {
      // The closing quote is the first one followed by `, name=` or `)`. That
      // tolerates unescaped apostrophes inside the value ("aujourd'hui").
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === "\\") {
          j++;
          continue;
        }
        if (s[j] === quote && NEXT_ARG_OR_END.test(s.slice(j + 1))) break;
      }
      if (j >= s.length) return null;
      args[key[1]] = s.slice(i + 1, j).replace(/\\(['"\\])/g, "$1");
      i = j + 1;
    } else {
      const bare = /^([\s\S]*?)(?=\s*(?:,\s*[A-Za-z_]\w*\s*=|\)))/.exec(s.slice(i));
      if (!bare) return null;
      args[key[1]] = coerce(bare[1]);
      i += bare[1].length;
    }
  }
}

/** `[name(a='x'), other(b=1)]`, the Python-style list. */
function parsePythonCalls(body: string): ToolCall[] | null {
  let s = body.trim();
  if (s.startsWith("[")) s = s.slice(1);
  const calls: ToolCall[] = [];
  let i = 0;
  for (;;) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length || s[i] === "]") break;
    const head = /^([A-Za-z_][\w.-]*)\s*\(/.exec(s.slice(i));
    if (!head) return null;
    const parsed = parseArgs(s, i + head[0].length);
    if (!parsed) return null;
    calls.push({ function: { name: head[1], arguments: parsed.args } });
    i = parsed.end;
  }
  return calls.length ? calls : null;
}

/** `{"name": "web_search", "arguments": {...}}` or a list of those. */
function parseJsonCalls(body: string): ToolCall[] | null {
  let value: unknown;
  try {
    value = JSON.parse(body.trim());
  } catch {
    return null;
  }
  const items = Array.isArray(value) ? value : [value];
  const calls: ToolCall[] = [];
  for (const item of items) {
    const o = item as { name?: unknown; arguments?: unknown; parameters?: unknown } | null;
    const args = o?.arguments ?? o?.parameters ?? {};
    if (typeof o?.name !== "string" || typeof args !== "object" || args === null) return null;
    calls.push({ function: { name: o.name, arguments: args as Args } });
  }
  return calls.length ? calls : null;
}

const NAME_KEYS = ["name", "tool", "function"] as const;
const ARG_KEYS = ["arguments", "parameters", "args"] as const;

/** `{"tool": "web_search", "query": "x"}`: name under any usual key, arguments nested or flat. */
function looseCall(item: unknown): ToolCall | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const nameKey = NAME_KEYS.find((k) => typeof o[k] === "string");
  // OpenAI style: {"function": {"name": ..., "arguments": ...}}
  if (!nameKey) return looseCall(o.function);
  const name = o[nameKey] as string;
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return null;
  const argKey = ARG_KEYS.find((k) => typeof o[k] === "object" && o[k] !== null && !Array.isArray(o[k]));
  const args = argKey
    ? (o[argKey] as Args)
    : Object.fromEntries(Object.entries(o).filter(([k]) => k !== nameKey && k !== "type"));
  return { function: { name, arguments: args } };
}

function parseLooseCalls(body: string): ToolCall[] | null {
  let value: unknown;
  try {
    value = JSON.parse(body.trim());
  } catch {
    return null;
  }
  const calls = (Array.isArray(value) ? value : [value]).map(looseCall);
  return calls.length > 0 && calls.every((c) => c !== null) ? (calls as ToolCall[]) : null;
}

/** Index just past the `}` that closes the `{` at `start`, or -1 if it isn't closed yet. */
function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** A stretch of text that is, or may still turn out to be, a JSON tool call. `calls` is null while undecided. */
interface Hit {
  start: number;
  end: number;
  calls: ToolCall[] | null;
}

/**
 * JSON-format calls in a text, in order: fenced blocks, then bare objects that
 * start a line. A block that is complete and not a call is left alone, so a
 * JSON example in an answer stays visible.
 */
function looseHits(text: string): Hit[] {
  const hits: Hit[] = [];
  const fences: [number, number][] = [];

  const fenceRe = /```([\w-]*)/g;
  for (let m = fenceRe.exec(text); m; m = fenceRe.exec(text)) {
    const start = m.index;
    const bodyStart = start + m[0].length;
    const close = text.indexOf("```", bodyStart);
    if (close >= 0) {
      const calls = parseLooseCalls(text.slice(bodyStart, close));
      fences.push([start, close + 3]);
      if (calls) hits.push({ start, end: close + 3, calls });
      fenceRe.lastIndex = close + 3;
      continue;
    }
    // Unclosed: the last fence. Hold it only while it could still be JSON.
    fences.push([start, text.length]);
    const lang = m[1].toLowerCase();
    const body = text.slice(bodyStart).trim();
    const couldBeJson = bodyStart === text.length ? "json".startsWith(lang) : (lang === "" || lang === "json") && (body === "" || /^[{[]/.test(body));
    if (couldBeJson) hits.push({ start, end: text.length, calls: parseLooseCalls(body) });
    break;
  }

  const inFence = (i: number) => fences.some(([a, b]) => i >= a && i < b);
  // One or two backticks at the very end may be the start of a fence.
  const tail = /`{1,2}$/.exec(text);
  if (tail && !inFence(tail.index)) hits.push({ start: tail.index, end: text.length, calls: null });

  const braceRe = /^[ \t]*\{/gm;
  for (let m = braceRe.exec(text); m; m = braceRe.exec(text)) {
    const start = m.index + m[0].length - 1;
    if (inFence(start)) continue;
    const end = balancedEnd(text, start);
    if (end < 0) {
      hits.push({ start, end: text.length, calls: null });
      break;
    }
    const calls = parseLooseCalls(text.slice(start, end));
    if (calls) hits.push({ start, end, calls });
    braceRe.lastIndex = end;
  }
  return hits.sort((a, b) => a.start - b.start);
}

/**
 * Finds the text-format tool calls in a finished text. `text` is the input with
 * every parsed call removed; a segment that can't be parsed stays in it, so
 * nothing the model wrote disappears silently. `raw` is the removed call text.
 */
export function extractToolCalls(text: string): { calls: ToolCall[]; text: string; raw: string[] } {
  const calls: ToolCall[] = [];
  const raw: string[] = [];
  let out = "";
  let rest = text;
  for (;;) {
    const at = rest.indexOf(CALL_START);
    if (at < 0) {
      out += rest;
      break;
    }
    const bodyStart = at + CALL_START.length;
    const endAt = rest.indexOf(CALL_END, bodyStart);
    const body = rest.slice(bodyStart, endAt < 0 ? undefined : endAt);
    const parsed = parseJsonCalls(body) ?? parsePythonCalls(body);
    if (!parsed) {
      out += rest;
      break;
    }
    calls.push(...parsed);
    raw.push(rest.slice(at, endAt < 0 ? undefined : endAt + CALL_END.length));
    out += rest.slice(0, at);
    if (endAt < 0) break;
    rest = rest.slice(endAt + CALL_END.length);
  }

  let kept = "";
  let from = 0;
  for (const hit of looseHits(out)) {
    if (!hit.calls) continue;
    calls.push(...hit.calls);
    raw.push(out.slice(hit.start, hit.end));
    kept += out.slice(from, hit.start);
    from = hit.end;
  }
  return { calls, text: kept + out.slice(from), raw };
}
