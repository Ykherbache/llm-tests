import "server-only";
import { IS_DESKTOP } from "./profile";

export const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
/**
 * CPU mode goes here: a server with no GPU backend, so "CPU" really is CPU only
 * (a Vulkan-enabled server offloads prompt processing to the GPU even with zero
 * GPU layers). Defaults to OLLAMA_BASE_URL when unset.
 */
export const OLLAMA_CPU_BASE_URL = (process.env.OLLAMA_CPU_BASE_URL ?? OLLAMA_BASE_URL).replace(/\/+$/, "");
export const SEARXNG_URL = (process.env.SEARXNG_URL ?? "http://127.0.0.1:8888").replace(/\/+$/, "");

/** The Ollama server for a backend mode: CPU -> the CPU-only server, everything else -> OLLAMA_BASE_URL. */
export function ollamaBaseFor(backend: unknown): string {
  if (IS_DESKTOP) return OLLAMA_BASE_URL;
  return backend === "cpu" ? OLLAMA_CPU_BASE_URL : OLLAMA_BASE_URL;
}

/** undici wraps socket errors: TypeError("fetch failed") { cause: { code } }. */
export function isConnRefused(e: unknown): boolean {
  const cause = (e as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  if (!cause) return false;
  if (cause.code === "ECONNREFUSED") return true;
  // localhost can resolve to ::1 and 127.0.0.1 -> AggregateError of both.
  return cause.errors?.some((x) => x.code === "ECONNREFUSED") ?? false;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The API is for this machine's browser only. Rejects other Host headers (LAN
 * access, DNS rebinding), cross-site Origins, and non-JSON bodies (a cross-site
 * no-cors POST can only send text/plain or form types). Returns a 403/415
 * response to send back, or null when the request is fine.
 */
export function rejectNonLocal(req: Request, needsJson = true): Response | null {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return json(403, { code: "bad_request", message: "Forbidden" });
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      // unparsable Origin: treat as foreign
    }
    if (originHost !== host) return json(403, { code: "bad_request", message: "Forbidden" });
  }
  if (needsJson && !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415, { code: "bad_request", message: "Expected application/json" });
  }
  return null;
}

export function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function ollamaDown(base: string = OLLAMA_BASE_URL): Response {
  return json(503, {
    code: "ollama_down",
    message: `Ollama isn't running at ${base} — start it with \`ollama serve\`.`,
  });
}
