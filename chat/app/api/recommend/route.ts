import { leaderboards } from "@/lib/leaderboards";
import { json, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leaderboard scores for the models the app knows how to download: live where a board
 * answers, the shipped snapshot otherwise. Fit and speed are worked out in the browser.
 */
export async function GET(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req, false);
  if (rejected) return rejected;
  return json(200, { ...(await leaderboards()) });
}
