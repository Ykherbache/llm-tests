import { readNdjson } from "./ndjson";
import type { WireMessage } from "./tokens";
import type { ToolsMode } from "./tools";
import type { BackendMode, ChatErrorCode, ChatErrorInfo, OllamaChunk } from "./types";

// Client-side helpers. The browser only ever talks to /api/* on its own
// origin; the route handlers proxy to OLLAMA_BASE_URL on the server.

export interface ChatRequest {
  model: string;
  messages: WireMessage[];
  options: { num_predict: number; temperature: number; num_gpu?: number };
  /** Ask the server to attach its tool schemas ("enable": only the one that turns web search on). */
  tools: ToolsMode;
  /** Which server answers: CPU mode and the GPU-capable modes use different ones. */
  backend?: BackendMode;
}

export class ChatError extends Error {
  readonly info: ChatErrorInfo;
  constructor(info: ChatErrorInfo) {
    super(info.message);
    this.name = "ChatError";
    this.info = info;
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

const KNOWN_CODES: readonly ChatErrorCode[] = [
  "ollama_down",
  "model_not_found",
  "bad_request",
  "upstream",
];

async function errorFromResponse(res: Response, model: string): Promise<ChatError> {
  let body: { code?: string; message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Non-JSON error body; fall through to the generic message.
  }
  const code = KNOWN_CODES.find((c) => c === body.code) ?? "upstream";
  return new ChatError({
    code,
    message: body.message ?? `Request failed with HTTP ${res.status}`,
    model,
  });
}

/** POSTs to /api/chat and yields Ollama's NDJSON chunks as they arrive. */
export async function* streamChat(
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<OllamaChunk> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ChatError({
      code: "network",
      message: "Could not reach the app server. Is `npm run dev` still running?",
    });
  }
  if (!res.ok) throw await errorFromResponse(res, req.model);
  if (!res.body) throw new ChatError({ code: "stream", message: "Empty response body" });

  try {
    for await (const chunk of readNdjson<OllamaChunk>(res.body)) {
      // Ollama reports failures after the 200 as an {"error": "..."} line.
      if (chunk.error) throw new ChatError({ code: "stream", message: chunk.error, model: req.model });
      yield chunk;
    }
  } catch (e) {
    if (isAbortError(e) || e instanceof ChatError) throw e;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw new ChatError({
      code: "stream",
      message: e instanceof Error ? e.message : "The stream was interrupted",
      model: req.model,
    });
  }
}

export interface HealthInfo {
  ok: boolean;
  installed: string[];
  loaded: string[];
  installedModels?: { tag: string; sizeBytes: number; family: string; paramSize: string; quant: string }[];
  /** Loaded model(s) and how much of each is in GPU memory (size_vram / size). */
  placement?: { tag: string; size: number; sizeVram: number }[];
  /** SearXNG reachable, so the web tools can be offered. */
  search: boolean;
  message?: string;
}

export async function fetchHealth(backend: BackendMode, signal?: AbortSignal): Promise<HealthInfo> {
  try {
    const res = await fetch(`/api/health?backend=${backend}`, { cache: "no-store", signal });
    return (await res.json()) as HealthInfo;
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { ok: false, installed: [], loaded: [], search: false, message: "App server unreachable" };
  }
}

/** Asks the app server to start the local SearXNG container. Resolves with an error message on failure, else null. */
export async function startSearch(): Promise<string | null> {
  try {
    const res = await fetch("/api/searxng", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = (await res.json()) as { up?: boolean; message?: string };
    return body.up ? null : (body.message ?? `Could not start SearXNG (HTTP ${res.status})`);
  } catch {
    return "App server unreachable";
  }
}

export interface PullProgress {
  status: string;
  /** Bytes of the layer being downloaded; absent for status-only lines. */
  total?: number;
  completed?: number;
}

/**
 * Downloads a model via /api/pull. Resolves with an error message on failure,
 * else null; aborting (Cancel) resolves null, and the partial blobs resume next time.
 */
export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch("/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    if (!res.ok) return ((await res.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${res.status}`;
    if (!res.body) return "Empty response body";
    for await (const line of readNdjson<PullProgress & { error?: string }>(res.body)) {
      if (line.error) return line.error;
      onProgress(line);
    }
    return null;
  } catch (e) {
    if (isAbortError(e) || signal.aborted) return null;
    return e instanceof Error ? e.message : "App server unreachable";
  }
}
