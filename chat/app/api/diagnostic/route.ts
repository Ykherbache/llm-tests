import fs from "node:fs";
import { IS_DESKTOP } from "@/lib/profile";
import { OLLAMA_BASE_URL, rejectNonLocal } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ollamaJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function logTail(lines: number): string {
  const file = process.env.APP_LOG_FILE;
  if (!file) return "(no log file)";
  try {
    return fs.readFileSync(file, "utf8").split("\n").slice(-lines).join("\n").trim() || "(empty)";
  } catch {
    return "(log unreadable)";
  }
}

/**
 * Plain-text report a friend can paste into a message: versions, what Ollama
 * has resident and how much of it sits in video memory, and the server log tail.
 * Nothing leaves the machine by itself, and no chat content is included.
 */
export async function GET(req: Request): Promise<Response> {
  const rejected = rejectNonLocal(req, false);
  if (rejected) return rejected;
  const [version, ps, tags] = await Promise.all([
    ollamaJson<{ version?: string }>("/api/version"),
    ollamaJson<{ models?: { name?: string; size?: number; size_vram?: number }[] }>("/api/ps"),
    ollamaJson<{ models?: unknown[] }>("/api/tags"),
  ]);
  const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;
  const loaded = (ps?.models ?? []).map(
    (m) => `  ${m.name}: ${gb(m.size ?? 0)} total, ${gb(m.size_vram ?? 0)} in video memory`,
  );
  const report = [
    `App: ${process.env.APP_VERSION ?? "dev"} (${IS_DESKTOP ? "desktop" : "asahi"} profile)`,
    `OS: ${process.platform} ${process.arch}, node ${process.version}`,
    `Ollama: ${version ? `${version.version} at ${OLLAMA_BASE_URL}` : `NOT REACHABLE at ${OLLAMA_BASE_URL}`}`,
    `Installed models: ${tags ? (tags.models?.length ?? 0) : "?"}`,
    `Loaded:${loaded.length ? `\n${loaded.join("\n")}` : " none"}`,
    "",
    "Server log (last 40 lines):",
    logTail(40),
  ].join("\n");
  return new Response(report, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
