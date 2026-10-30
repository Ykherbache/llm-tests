import { fetchPage } from "@/lib/fetchPage";
import { startSearxng, webSearch } from "@/lib/searxng";
import { isConnRefused, json, rejectNonLocal, SEARXNG_URL } from "@/lib/server";
import { isToolName, PAGE_TEXT_LIMIT } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Executes one tool call. Tool failures come back as 200 with `error`, and
 * `content` describes the failure, so the client can hand it to the model
 * and let it recover (try another query or URL).
 */
export async function POST(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req);
  if (rejected) return rejected;
  let body: { name?: unknown; arguments?: Record<string, unknown>; pageChars?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { message: "Body must be JSON" });
  }
  if (!isToolName(body.name)) return json(400, { message: `Unknown tool: ${String(body.name)}` });
  const args = body.arguments ?? {};

  if (body.name === "enable_web_search") {
    const { up, message } = await startSearxng();
    if (up) return json(200, { content: "Web search is now on. You can call web_search and fetch_url." });
    return json(200, { content: `Error: ${message}`, error: message });
  }

  // Optional per-request page size, from the effort level; never above the global cap.
  const pageChars =
    typeof body.pageChars === "number" && Number.isFinite(body.pageChars)
      ? Math.min(PAGE_TEXT_LIMIT, Math.max(0, Math.round(body.pageChars)))
      : null;

  try {
    if (body.name === "web_search") {
      return json(200, { ...(await webSearch(String(args.query ?? ""), req.signal, pageChars ?? 0)) });
    }
    return json(200, { ...(await fetchPage(String(args.url ?? ""), req.signal, pageChars || PAGE_TEXT_LIMIT)) });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const message =
      body.name === "web_search" && isConnRefused(e)
        ? `Search is unavailable: SearXNG isn't running at ${SEARXNG_URL} (start it with scripts/searxng.sh).`
        : e instanceof Error
          ? e.message
          : String(e);
    return json(200, { content: `Error: ${message}`, error: message });
  }
}
