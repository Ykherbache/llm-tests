/**
 * Frees every model an Ollama server holds in memory (`keep_alive: 0` unloads
 * right away). Shared by the API routes and Electron's main process, so it
 * imports nothing from Next. Never throws: Ollama being down means there is
 * nothing to unload. Returns the tags it asked Ollama to unload.
 */
export async function unloadAll(base: string): Promise<string[]> {
  try {
    const ps = await fetch(`${base}/api/ps`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    const { models = [] } = (await ps.json()) as { models?: { name?: string; model?: string }[] };
    const tags = models.map((m) => m.name ?? m.model).filter((t): t is string => !!t);
    await Promise.all(
      tags.map((model) =>
        fetch(`${base}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, keep_alive: 0 }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {}),
      ),
    );
    return tags;
  } catch {
    return [];
  }
}
