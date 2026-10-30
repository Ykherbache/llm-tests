import { TAG_RE } from "@/lib/models";
import { isConnRefused, json, OLLAMA_BASE_URL, ollamaDown, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads a model into Ollama and pipes its NDJSON progress back
 * ({status, total, completed} lines). Same pass-through as /api/chat.
 */
export async function POST(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req);
  if (rejected) return rejected;
  let body: { model?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { code: "bad_request", message: "Body must be JSON" });
  }
  if (typeof body.model !== "string" || !TAG_RE.test(body.model)) {
    return json(400, { code: "bad_request", message: "Invalid model tag" });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: body.model, stream: true }),
      // Cancel in the UI aborts the download; Ollama resumes partial blobs next time.
      signal: req.signal,
    });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (isConnRefused(e)) return ollamaDown(OLLAMA_BASE_URL);
    return json(502, { code: "upstream", message: `Could not reach Ollama: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return json(upstream.status, { code: "upstream", message: text || `Ollama returned HTTP ${upstream.status}` });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
