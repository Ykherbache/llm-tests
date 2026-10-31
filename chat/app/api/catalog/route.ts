import { HF_REPO_RE, hfVariants, OLLAMA_NAME_RE, ollamaVariants, searchHf, searchOllama } from "@/lib/catalog";
import { json, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Model search for the Models dialog. `?source=ollama|hf&q=...` lists matching
 * models; `?source=...&model=...` lists the downloadable sizes of one of them.
 * Only talks to ollama.com and huggingface.co.
 */
export async function GET(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req, false);
  if (rejected) return rejected;
  const params = new URL(req.url).searchParams;
  const source = params.get("source");
  if (source !== "ollama" && source !== "hf") return json(400, { code: "bad_request", message: "Invalid source" });
  const q = params.get("q");
  const model = params.get("model");
  try {
    if (model !== null) {
      if (!(source === "hf" ? HF_REPO_RE : OLLAMA_NAME_RE).test(model)) {
        return json(400, { code: "bad_request", message: "Invalid model name" });
      }
      return json(200, { variants: await (source === "hf" ? hfVariants(model) : ollamaVariants(model)) });
    }
    const query = q?.trim() ?? "";
    if (query.length < 1 || query.length > 100) return json(400, { code: "bad_request", message: "Query must be 1-100 characters" });
    return json(200, { hits: await (source === "hf" ? searchHf(query) : searchOllama(query)) });
  } catch (e) {
    return json(502, { code: "upstream", message: e instanceof Error ? e.message : String(e) });
  }
}
