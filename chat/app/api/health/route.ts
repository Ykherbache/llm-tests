import { normalizeTag } from "@/lib/models";
import { searchUp } from "@/lib/search";
import { isConnRefused, json, ollamaBaseFor, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OllamaModel {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

async function getModels(base: string, path: string): Promise<OllamaModel[]> {
  const res = await fetch(`${base}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  const body = (await res.json()) as { models?: OllamaModel[] };
  return (body.models ?? []).filter((m) => m.name ?? m.model);
}

const tagOf = (m: OllamaModel) => normalizeTag(m.name ?? m.model ?? "");

/**
 * Installed models (/api/tags), resident model(s) with where they sit (/api/ps),
 * and whether web search is available. `placement.sizeVram / size` is the share
 * of the loaded model that is actually on the GPU.
 */
export async function GET(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req, false);
  if (rejected) return rejected;
  // Ask the server the selected backend would use, so "loaded" and "placement" describe it.
  const base = ollamaBaseFor(new URL(req.url).searchParams.get("backend"));
  const search = searchUp();
  try {
    const [tags, ps] = await Promise.all([getModels(base, "/api/tags"), getModels(base, "/api/ps")]);
    return json(200, {
      ok: true,
      installed: tags.map(tagOf),
      installedModels: tags.map((m) => ({
        tag: tagOf(m),
        sizeBytes: m.size ?? 0,
        family: m.details?.family ?? "",
        paramSize: m.details?.parameter_size ?? "",
        quant: m.details?.quantization_level ?? "",
      })),
      loaded: ps.map(tagOf),
      placement: ps.map((m) => ({ tag: tagOf(m), size: m.size ?? 0, sizeVram: m.size_vram ?? 0 })),
      search: await search,
    });
  } catch (e) {
    const message = isConnRefused(e)
      ? "Ollama isn't running — start it with `ollama serve`."
      : `Ollama health check failed: ${e instanceof Error ? e.message : String(e)}`;
    return json(200, { ok: false, installed: [], installedModels: [], loaded: [], placement: [], search: await search, message });
  }
}
