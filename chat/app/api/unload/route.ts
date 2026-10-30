import { json, OLLAMA_BASE_URL, OLLAMA_CPU_BASE_URL, rejectNonLocal } from "@/lib/server";
import { unloadAll } from "@/lib/unload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unloads every resident model, on both Ollama servers when CPU and GPU modes use two. */
export async function POST(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req);
  if (rejected) return rejected;
  const bases = new Set([OLLAMA_BASE_URL, OLLAMA_CPU_BASE_URL]);
  const unloaded = (await Promise.all([...bases].map(unloadAll))).flat();
  return json(200, { unloaded });
}
