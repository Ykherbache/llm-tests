import { IS_DESKTOP } from "@/lib/profile";
import { unloadAll } from "@/lib/unload";
import { DEFAULT_MAX_TOKENS, isThreadCapped, KEEP_ALIVE, TAG_RE } from "@/lib/models";
import { isConnRefused, json, OLLAMA_BASE_URL, OLLAMA_CPU_BASE_URL, ollamaBaseFor, ollamaDown, rejectNonLocal } from "@/lib/server";
import { ENABLE_SCHEMAS, SEARCH_ONLY_SCHEMAS, TOOL_NAME_RE, TOOL_SCHEMAS } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = new Set(["system", "user", "assistant", "tool"]);

interface Body {
  model?: unknown;
  messages?: unknown;
  /** true = attach the server's own tool schemas, "search" = only web_search, "enable" = only enable_web_search; the client never sends schemas. */
  tools?: unknown;
  /** Backend mode; "cpu" is sent to the CPU-only server, the rest to the GPU-capable one. */
  backend?: unknown;
  options?: { num_predict?: unknown; temperature?: unknown; num_gpu?: unknown };
}

/**
 * CPU and GPU modes use two servers. Switching between them would leave the
 * model resident on both (15+ GB each on a 31 GB machine), so unload whatever
 * the other server holds. Best effort: a failure here must not block the chat.
 */
async function evictOther(base: string): Promise<void> {
  const other = base === OLLAMA_CPU_BASE_URL ? OLLAMA_BASE_URL : OLLAMA_CPU_BASE_URL;
  if (other === base) return;
  await unloadAll(other);
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

interface WireIn {
  role?: unknown;
  content?: unknown;
  tool_name?: unknown;
  tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[];
}

/** Whitelists the message shapes Ollama accepts for a tool-calling loop. */
function cleanMessage(m: WireIn): Record<string, unknown> | null {
  if (typeof m?.role !== "string" || !ROLES.has(m.role) || typeof m.content !== "string") return null;
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  // Tool names are echoed back from the model's own calls (including names it
  // invented, which get an error result); only the schemas are server-owned.
  if (m.role === "tool") {
    if (typeof m.tool_name !== "string" || !TOOL_NAME_RE.test(m.tool_name)) return null;
    out.tool_name = m.tool_name;
  }
  if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
    const calls = [];
    for (const c of m.tool_calls) {
      const name = c?.function?.name;
      const args = c?.function?.arguments;
      if (typeof name !== "string" || !TOOL_NAME_RE.test(name) || typeof args !== "object" || args === null) return null;
      calls.push({ function: { name, arguments: args } });
    }
    out.tool_calls = calls;
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req);
  if (rejected) return rejected;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { code: "bad_request", message: "Body must be JSON" });
  }

  const model = body.model;
  if (typeof model !== "string" || !TAG_RE.test(model)) {
    return json(400, { code: "bad_request", message: "Invalid model tag" });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json(400, { code: "bad_request", message: "messages must be a non-empty array" });
  }
  const messages: Record<string, unknown>[] = [];
  for (const m of body.messages as WireIn[]) {
    const clean = cleanMessage(m);
    if (!clean) {
      return json(400, { code: "bad_request", message: "Each message needs a role and string content" });
    }
    messages.push(clean);
  }

  // Forwarded options: num_predict, temperature, and the GPU layer count.
  // num_ctx is deliberately absent (changing it reloads the model). num_gpu
  // also reloads the model, but only when the user flips the backend switch.
  // num_thread is pinned to 6 for raw model tags; the thread-capped aliases
  // already carry it, so it is never sent for those.
  const options: Record<string, number> = {
    num_predict: Math.round(clamp(body.options?.num_predict, 1, 16384, DEFAULT_MAX_TOKENS)),
    temperature: clamp(body.options?.temperature, 0, 2, 0.7),
  };
  if (typeof body.options?.num_gpu === "number" && Number.isFinite(body.options.num_gpu)) {
    options.num_gpu = Math.round(clamp(body.options.num_gpu, 0, 999, 0));
  }
  if (!IS_DESKTOP && !isThreadCapped(model)) options.num_thread = 6;

  const base = ollamaBaseFor(body.backend);
  await evictOther(base);
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: KEEP_ALIVE,
        options,
        ...(body.tools === true
          ? { tools: TOOL_SCHEMAS }
          : body.tools === "search"
            ? { tools: SEARCH_ONLY_SCHEMAS }
            : body.tools === "enable"
              ? { tools: ENABLE_SCHEMAS }
              : {}),
      }),
      // Client disconnect / Stop -> abort the upstream request so Ollama
      // stops generating instead of finishing a reply nobody reads.
      signal: req.signal,
    });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (isConnRefused(e)) return ollamaDown(base);
    return json(502, {
      code: "upstream",
      message: `Could not reach Ollama at ${base}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // plain-text error body
    }
    if (upstream.status === 404 || /not found/i.test(message)) {
      return json(404, { code: "model_not_found", model, message: message || `model '${model}' not found` });
    }
    return json(upstream.status, { code: "upstream", message: message || `Ollama returned HTTP ${upstream.status}` });
  }

  // Pipe Ollama's NDJSON straight through: no buffering, no re-encoding.
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
