import { startSearxng } from "@/lib/search";
import { json, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts the local SearXNG container (scripts/searxng.sh) and waits until it answers. */
export async function POST(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req);
  if (rejected) return rejected;
  const { up, message } = await startSearxng();
  return json(200, { up, message });
}
