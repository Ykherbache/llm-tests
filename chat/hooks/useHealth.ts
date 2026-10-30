"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHealth, type HealthInfo } from "@/lib/ollama";
import type { BackendMode } from "@/lib/types";

const POLL_MS = 15_000;

/** Polls /api/health (server-side /api/tags + /api/ps) while the tab is visible. */
export function useHealth(paused: boolean, backend: BackendMode) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const h = await fetchHealth(backend, ctrl.signal);
      if (!ctrl.signal.aborted) setHealth(h);
    } catch {
      // aborted by a newer refresh
    }
  }, [backend]);

  useEffect(() => {
    if (paused) return;
    void refresh();
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
      inflight.current?.abort();
    };
  }, [paused, refresh]);

  return { health, refresh };
}
