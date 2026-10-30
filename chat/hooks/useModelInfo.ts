"use client";

import { useEffect, useState } from "react";

export interface ModelFacts {
  /** Transformer layer count, null while unknown. */
  layers: number | null;
  /** Supports tool calling; null while unknown or when Ollama doesn't say. */
  tools: boolean | null;
}

const UNKNOWN: ModelFacts = { layers: null, tools: null };
const cache = new Map<string, ModelFacts>();

/** Layer count and tool support of a model, cached per tag for the page's life. */
export function useModelInfo(tag: string): ModelFacts {
  const [facts, setFacts] = useState<ModelFacts>(cache.get(tag) ?? UNKNOWN);
  useEffect(() => {
    const hit = cache.get(tag);
    if (hit) {
      setFacts(hit);
      return;
    }
    setFacts(UNKNOWN);
    const ctrl = new AbortController();
    fetch(`/api/model?tag=${encodeURIComponent(tag)}`, { cache: "no-store", signal: ctrl.signal })
      .then((r): Promise<Partial<ModelFacts>> => (r.ok ? r.json() : Promise.resolve({})))
      .then((b) => {
        const next: ModelFacts = {
          layers: typeof b.layers === "number" ? b.layers : null,
          tools: typeof b.tools === "boolean" ? b.tools : null,
        };
        // Only cache a real answer; a failure is retried next time the tag is selected.
        if (next.layers !== null || next.tools !== null) cache.set(tag, next);
        setFacts(next);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [tag]);
  return facts;
}
