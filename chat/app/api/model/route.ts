import { isConnRefused, json, OLLAMA_BASE_URL, ollamaDown, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG_RE = /^[\w.\-/:]{1,200}$/;

/**
 * Facts about one model from /api/show: its layer count (`<arch>.block_count`, used
 * for the Hybrid default and maximum) and whether it supports tool calling.
 */
export async function GET(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req, false);
  if (rejected) return rejected;
  const tag = new URL(req.url).searchParams.get("tag") ?? "";
  if (!TAG_RE.test(tag)) return json(400, { code: "bad_request", message: "Invalid model tag" });
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: tag }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return json(404, { code: "model_not_found", model: tag, message: `model '${tag}' not found` });
    if (!res.ok) return json(res.status, { code: "upstream", message: `Ollama returned HTTP ${res.status}` });
    const body = (await res.json()) as { model_info?: Record<string, unknown>; capabilities?: string[] };
    const info = body.model_info ?? {};
    const key = Object.keys(info).find((k) => k.endsWith(".block_count"));
    const layers = key && typeof info[key] === "number" ? (info[key] as number) : null;
    // null = this Ollama version did not report capabilities.
    const tools = Array.isArray(body.capabilities) ? body.capabilities.includes("tools") : null;
    return json(200, { layers, tools });
  } catch (e) {
    if (isConnRefused(e)) return ollamaDown();
    return json(502, { code: "upstream", message: e instanceof Error ? e.message : String(e) });
  }
}
